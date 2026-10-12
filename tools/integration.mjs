import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
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
    API_DOMAIN: api, WEBSITE_URL: previewUrl, ADDITIONAL_WEBSITE_ORIGINS: "https://old-site.example", COMMENTS_DB_PATH: path.join(directory, "comments.db"),
    SUPERTOKENS_CONNECTION_URI: "http://127.0.0.1:39999", SUPERTOKENS_API_KEY: "local-integration-test-only", BACKUP_TOKEN: "integration-backup-token-0123456789abcdef", CLIENT_IP_HEADER: "x-real-ip" },
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
  assert.deepEqual(await (await request(`${api}/healthz`)).json(), { ok: true, version: "dev" });
  assert.deepEqual(await (await request(`${api}/`)).json(), { ok: true });
  const backupUrl = `${api}/api/admin/backup`;
  assert.equal((await request(backupUrl)).status, 401);
  assert.equal((await request(backupUrl, { headers: { Authorization: "Bearer wrong-token-wrong-token-wrong-token" } })).status, 401);
  const snapshot = await request(backupUrl, { headers: { Authorization: "Bearer integration-backup-token-0123456789abcdef", Origin: previewUrl } });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.headers.get("access-control-allow-origin"), null, "backup must not be readable cross-origin");
  assert.equal(snapshot.headers.get("cache-control"), "no-store");
  assert.match(snapshot.headers.get("content-disposition"), /^attachment; filename="comments-\d{8}\.db"$/);
  assert.equal(Buffer.from(await snapshot.arrayBuffer()).subarray(0, 16).toString("latin1"), "SQLite format 3\0");
  assert.doesNotMatch(output, /integration-backup-token/, "token must never be logged");
  const get = await request(`${api}/api/comments`, { headers: { Origin: previewUrl } });
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("access-control-allow-origin"), previewUrl);
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.match(get.headers.get("content-security-policy"), /default-src 'none'/);
  assert.ok(get.headers.get("x-request-id"));
  assert.deepEqual((await get.json()).comments, []);
  assert.equal((await request(`${api}/api/comments`, { headers: { Origin: "https://untrusted.example" } })).status, 403);
  const legacy = await request(`${api}/api/comments`, { headers: { Origin: "https://old-site.example" } });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.headers.get("access-control-allow-origin"), "https://old-site.example");
  // An allowed Origin is not authentication: protected routes still need a session.
  assert.equal((await request(`${api}/api/comments/mine`, { headers: { Origin: "https://old-site.example" } })).status, 401);
  assert.equal((await request(`${api}/api/admin/comments/1`, { method: "DELETE", headers: { Origin: previewUrl } })).status, 401);
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
  assert.equal((await request(`${api}/api/admin/comments`)).status, 401);
  // Omitting or spoofing Origin must never grant protected access.
  assert.equal((await request(`${api}/api/admin/comments`, { headers: { Origin: previewUrl } })).status, 401);
  assert.equal((await request(`${api}/api/comments/${comment.id}`, { method: "DELETE" })).status, 401);
  assert.equal((await request(`${api}/api/comments`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hello" })).status, 415);
  assert.equal((await request(`${api}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  assert.equal((await request(`${api}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "x".repeat(22000) }) })).status, 413);
  // Exercise the actual middleware order: no body may reach the SDK's unlimited
  // fallback parser after bypassing Express's JSON parser by its content type.
  const oversizedAuth = Buffer.from(JSON.stringify({ formFields: [], padding: "x".repeat(65536) }));
  for (const endpoint of ["/auth/signin", "/auth/public/signup", "/auth/public/user/password/reset/token"]) {
    for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded"]) {
      const headers = contentType ? { "Content-Type": contentType } : {};
      const result = await request(api + endpoint, { method: "POST", headers, body: oversizedAuth });
      assert.equal(result.status, 415, `${endpoint}: ${contentType}`);
      assert.equal((await result.json()).code, "UNSUPPORTED_MEDIA_TYPE");
    }
  }
  const compressedAuth = gzipSync(oversizedAuth);
  for (const contentType of ["text/plain", "application/json"]) {
    const result = await request(`${api}/auth/signin`, { method: "POST", headers: {
      "Content-Type": contentType, "Content-Encoding": "gzip"
    }, body: compressedAuth });
    assert.equal(result.status, contentType === "application/json" ? 413 : 415);
    await result.arrayBuffer();
  }
  const invalidCharset = await request(`${api}/auth/signin`, { method: "POST", headers: {
    "Content-Type": "application/json; charset=iso-8859-1"
  }, body: "{}" });
  assert.equal(invalidCharset.status, 415);
  assert.equal((await invalidCharset.json()).code, "UNSUPPORTED_MEDIA_TYPE");
  const bodylessRefresh = await request(`${api}/auth/session/refresh`, { method: "POST" });
  assert.equal(bodylessRefresh.status, 401, "bodyless refresh reaches session verification");
  await bodylessRefresh.arrayBuffer();
  assert.equal((await request(`${api}/api/missing`)).status, 404);
  assert.equal((await (await request(`${api}/api/comments`)).json()).comments.length, 1);
  let deleteLimited = false;
  for (let i = 0; i < 31; i++) {
    const result = await request(`${api}/API/ADMIN/COMMENTS/1`, { method: "DELETE" });
    await result.arrayBuffer();
    if (result.status === 429) { deleteLimited = true; break; }
    assert.equal(result.status, 401);
  }
  assert.ok(deleteLimited, "Case variants must not bypass deletion throttling");
  for (let i = 0; i < 130; i++) {
    const result = await request(`${api}/api/comments`);
    await result.arrayBuffer();
    if (result.status === 429) { assert.ok(result.headers.get("retry-after")); break; }
    assert.ok(i < 129, "Read throttling should eventually return 429");
  }
  // Buckets follow the edge-set client IP, so one visitor cannot exhaust everyone's quota.
  assert.equal((await request(`${api}/api/comments`)).status, 429);
  assert.equal((await request(`${api}/api/comments`, { headers: { "X-Real-IP": "203.0.113.9" } })).status, 200);
  assert.equal((await request(`${api}/api/comments`, { headers: { "X-Real-IP": "not-an-ip" } })).status, 429, "invalid header falls back to the socket address");
  // Invalid JSON used to escape all route-level limits because parsing ran first.
  let malformedLimited = false;
  for (let i = 0; i < 181; i++) {
    const result = await request(`${api}/missing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    const body = await result.json();
    if (result.status === 429) {
      assert.equal(body.code, "RATE_LIMITED");
      assert.ok(result.headers.get("retry-after"));
      malformedLimited = true;
      break;
    }
    assert.equal(result.status, 400);
    assert.equal(body.code, "INVALID_JSON");
  }
  assert.ok(malformedLimited, "Malformed requests must be limited before JSON parsing");
  const limited = await request(`${api}/api/comments`, { headers: { Origin: previewUrl } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("access-control-allow-origin"), previewUrl, "the frontend must be able to read the global rate-limit response");
  assert.equal(limited.headers.get("access-control-allow-credentials"), "true");
  assert.match(limited.headers.get("access-control-expose-headers"), /Retry-After/i);
  assert.equal((await limited.json()).code, "RATE_LIMITED");
  for (const [url, origin] of [[`${api}/api/comments`, "https://untrusted.example"], [backupUrl, previewUrl]]) {
    const denied = await request(url, { headers: { Origin: origin } });
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
    await denied.arrayBuffer();
  }
  // CORS rejections and preflights used to run before every limiter.
  for (const [label, options] of [["hostile Origin", { headers: { Origin: "https://untrusted.example", "X-Real-IP": "198.51.100.71" } }],
    ["preflight", { method: "OPTIONS", headers: { Origin: previewUrl, "Access-Control-Request-Method": "POST", "X-Real-IP": "198.51.100.72" } }]]) {
    const statuses = {};
    for (let i = 0; i < 200; i++) {
      const result = await request(`${api}/api/comments`, options);
      await result.arrayBuffer();
      statuses[result.status] = (statuses[result.status] || 0) + 1;
    }
    assert.equal(statuses[429], 20, `${label}: ${JSON.stringify(statuses)}`);
  }
  // Probing for (or squatting on) a recent guest text costs guest quota.
  const guestPost = (ip, content) => request(`${api}/api/comments`, { method: "POST", headers: { "Content-Type": "application/json", "X-Real-IP": ip }, body: JSON.stringify({ nickname: "探测", content }) });
  const probes = [];
  for (let i = 0; i < 3; i++) probes.push((await guestPost("198.51.100.73", comment.content)).status);
  probes.push((await guestPost("198.51.100.73", "另一条完全不同的测试留言内容")).status);
  assert.deepEqual(probes, [409, 409, 409, 429], "duplicates must consume the guest hourly quota");
  child.kill("SIGTERM");
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  console.log("HTTP integration passed: isolated guest posting, deduplication, auth boundaries, CORS, headers, auth parser/body limits, read throttling, public-only preview and graceful shutdown.");
} finally {
  if (child.exitCode === null) child.kill("SIGKILL");
  preview.closeAllConnections();
  await new Promise(resolve => preview.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
