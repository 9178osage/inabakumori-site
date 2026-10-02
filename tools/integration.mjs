import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createStaticServer } from "./static-server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "station-http-test-"));
const preview = createStaticServer(path.join(root, "dist"));
preview.listen(0, "127.0.0.1");
await once(preview, "listening");
const previewUrl = `http://127.0.0.1:${preview.address().port}`;
// Reserve an unused port. The subprocess uses a completely isolated database/environment.
const reservation = createStaticServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const api = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(root, "backend/server.mjs")], {
  cwd: directory,
  env: { PATH: process.env.PATH, NODE_ENV: "development", HOST: "127.0.0.1", PORT: String(port),
    API_DOMAIN: api, WEBSITE_URL: previewUrl, COMMENTS_DB_PATH: path.join(directory, "comments.db"),
    SUPERTOKENS_CONNECTION_URI: "http://127.0.0.1:39999", SUPERTOKENS_API_KEY: "local-integration-test-only" },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", chunk => output += chunk);
child.stderr.on("data", chunk => output += chunk);
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`Test API exited: ${output}`);
    try { if ((await request(`${api}/healthz`)).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, `Test API did not start: ${output}`);
  const page = await request(`${previewUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-song-title=/);
  for (const file of ["/backend/.env", "/backend/server.mjs", "/AI_HANDOFF.md", "/docs/AI_HANDOFF.md", "/docs/OPTIMIZATION.md", "/.git/config"]) assert.equal((await request(previewUrl + file)).status, 404);
  const get = await request(`${api}/api/comments`, { headers: { Origin: previewUrl } });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("access-control-allow-origin"), previewUrl);
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.match(get.headers.get("content-security-policy"), /default-src 'none'/);
  assert.ok(get.headers.get("x-request-id"));
  assert.deepEqual((await get.json()).comments, []);
  assert.equal((await request(`${api}/api/comments`, { headers: { Origin: "https://untrusted.example" } })).status, 403);
  const post = body => request(`${api}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json", Origin: previewUrl }, body: JSON.stringify(body) });
  assert.equal((await post({ nickname: "测试", content: "\u200B" })).status, 400);
  const created = await post({ nickname: "测试", content: "稲葉曇的音乐很好听 ☔" });
  assert.equal(created.status, 201, await created.clone().text());
  const { comment } = await created.json();
  assert.equal(comment.isGuest, true);
  const createdAt = Date.parse(comment.createdAt);
  const expiresAt = Date.parse(comment.expiresAt);
  assert.equal(expiresAt - createdAt, 182 * 24 * 60 * 60 * 1e3);
  assert.equal((await post({ nickname: "另一个昵称", content: comment.content })).status, 409);
  assert.equal((await request(`${api}/api/comments/mine`)).status, 401);
  assert.equal((await request(`${api}/api/comments/${comment.id}`, { method: "DELETE" })).status, 401);
  assert.equal((await request(`${api}/api/comments`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hello" })).status, 415);
  assert.equal((await request(`${api}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  assert.equal((await request(`${api}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "x".repeat(22000) }) })).status, 413);
  assert.equal((await request(`${api}/api/missing`)).status, 404);
  assert.equal((await (await request(`${api}/api/comments`)).json()).comments.length, 1);
  for (let i = 0; i < 130; i++) {
    const result = await request(`${api}/api/comments`);
    await result.arrayBuffer();
    if (result.status === 429) { assert.ok(result.headers.get("retry-after")); break; }
    assert.ok(i < 129, "Read throttling should eventually return 429");
  }
  child.kill("SIGTERM");
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  console.log("HTTP integration passed: isolated guest posting, deduplication, auth boundaries, CORS, headers, JSON limits, read throttling, public-only preview and graceful shutdown.");
} finally {
  if (child.exitCode === null) child.kill("SIGKILL");
  preview.closeAllConnections();
  await new Promise(resolve => preview.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
