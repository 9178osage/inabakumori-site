const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("../../backend/node_modules/express");

async function serve(t, env) {
  const { commentWriteMaintenance } = await import("../../backend/maintenance.mjs");
  const app = express();
  let downstreamCalls = 0;
  app.use(commentWriteMaintenance(env));
  app.use((req, res) => { downstreamCalls++; res.json({ ok: true, method: req.method }); });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve(listening));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    get downstreamCalls() { return downstreamCalls; },
    request(method, path) {
      // Use the raw HTTP path so URL normalisation cannot hide a bypass in the test client.
      return new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port: server.address().port, method, path }, res => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", chunk => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on("error", reject);
        req.end();
      });
    }
  };
}

test("maintenance blocks all normalised comment POST/DELETE paths before downstream handlers", async t => {
  const app = await serve(t, { COMMENTS_READ_ONLY: "1" });
  for (const path of [
    "/api/comments", "/api/comments/13", "/api/comments/mine?before=13", "/api/admin/comments", "/api/admin/comments/13",
    "/API/COMMENTS", "//api///comments//13/", "/API//ADMIN/COMMENTS/13/?mode=1",
    "/outside/%2e%2e/api/comments", "/api%2fadmin%2fcomments/13", "/api\\comments/13"
  ]) {
    for (const method of ["POST", "DELETE"]) {
      const response = await app.request(method, path);
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.equal(response.headers["retry-after"], "300");
      assert.equal(response.headers["cache-control"], "no-store");
      assert.match(response.headers["content-type"], /^application\/json/u);
      assert.deepEqual(JSON.parse(response.body), { error: "留言维护中，请稍后再试", code: "COMMENTS_READ_ONLY" });
    }
  }
  assert.equal(app.downstreamCalls, 0, "no write handler is reached while frozen");
});

test("maintenance keeps reads, health, authentication, backups and unrelated routes reachable", async t => {
  const app = await serve(t, { COMMENTS_READ_ONLY: "1" });
  const requests = [
    ["GET", "/api/comments"], ["GET", "/api/comments/mine"], ["GET", "/api/admin/comments"],
    ["HEAD", "/api/comments"], ["OPTIONS", "/api/comments"], ["PUT", "/api/comments"],
    ["GET", "/healthz"], ["POST", "/auth/signin"], ["POST", "/auth/session/refresh"], ["POST", "/auth/signout"],
    ["GET", "/api/admin/backup"], ["POST", "/api/admin/backup"], ["DELETE", "/api/comments-other/13"],
    ["POST", "/outside/api/comments"], ["POST", "/"]
  ];
  for (const [method, path] of requests) {
    const response = await app.request(method, path);
    assert.equal(response.status, 200, `${method} ${path}`);
    assert.equal(response.headers["retry-after"], undefined);
  }
  assert.equal(app.downstreamCalls, requests.length);
});

test("only the exact value 1 enables maintenance and a redeployed disabled instance accepts writes", async t => {
  for (const value of [undefined, "", "0", "true", " 1 "]) {
    const app = await serve(t, { COMMENTS_READ_ONLY: value });
    for (const method of ["POST", "DELETE"]) {
      const response = await app.request(method, "/api/admin/comments/13");
      assert.equal(response.status, 200, String(value));
      assert.equal(response.headers["retry-after"], undefined);
    }
    assert.equal(app.downstreamCalls, 2);
  }
});
