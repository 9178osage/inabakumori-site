const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const express = createRequire(path.join(__dirname, "../../backend/package.json"))("express");

function get(port, pathname) {
  return new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, agent: false }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body, complete: res.complete }));
      res.on("error", error => resolve({ status: res.statusCode, headers: res.headers, body, error: error.code }));
      res.on("aborted", () => resolve({ status: res.statusCode, headers: res.headers, body, error: "aborted" }));
    });
    req.on("error", error => resolve({ error: error.code }));
  });
}

for (const isProduction of [false, true]) test(`final error handler delegates a mid-stream error to Express (production=${isProduction})`, async () => {
  const { createFinalErrorHandler } = await import("../../backend/services.mjs");
  const app = express();
  // Test-only routes on an isolated app; production server.mjs gets no extra routes.
  app.get("/stream", (req, res, next) => {
    res.status(200).type("text/plain");
    res.write("partial-");
    setImmediate(() => next(new Error("stream failed after headers")));
  });
  app.get("/sent", (req, res, next) => { res.status(202).json({ ok: true }); next(new Error("late error")); });
  app.get("/fail", (req, res, next) => next(new Error("boom")));
  app.get("/ok", (req, res) => res.json({ ok: true }));
  app.use(createFinalErrorHandler({ isProduction }));

  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.map(String).join(" "));
  const uncaught = [];
  const onUncaught = error => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const { port } = server.address();
  try {
    const streamed = await get(port, "/stream");
    assert.equal(streamed.status, 200, "headers already sent keep their original status");
    assert.ok(streamed.body.startsWith("partial-"), "the partial body reached the client");
    assert.ok(streamed.error || !streamed.complete, "Express aborts the broken stream instead of finishing it as success");
    assert.doesNotMatch(streamed.body, /INTERNAL_SERVER_ERROR/u, "no JSON error appended to a started response");

    const sent = await get(port, "/sent");
    assert.equal(sent.status, 202);
    assert.deepEqual(JSON.parse(sent.body), { ok: true });

    const failed = await get(port, "/fail");
    assert.equal(failed.status, 500);
    assert.equal(JSON.parse(failed.body).code, "INTERNAL_SERVER_ERROR");

    // The process and the listener stay healthy after both delegated errors.
    const ok = await get(port, "/ok");
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { ok: true });
    assert.deepEqual(uncaught, []);
    assert.ok(!logged.some(line => /ERR_HTTP_HEADERS_SENT|Cannot set headers after they are sent/u.test(line)), logged.join("\n"));
  } finally {
    console.error = originalError;
    process.off("uncaughtException", onUncaught);
    await new Promise(resolve => server.close(resolve));
  }
});

test("final error handler without the early check would hit ERR_HTTP_HEADERS_SENT (control)", async () => {
  // Proves the scenario above is meaningful: answering JSON after headers were sent throws.
  const app = express();
  let thrown;
  app.get("/sent", (req, res, next) => { res.status(202).json({ ok: true }); next(new Error("late")); });
  app.use((err, req, res, next) => { try { res.status(500).json({ code: "X" }); } catch (error) { thrown = error; } next(); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    await get(server.address().port, "/sent");
    assert.equal(thrown?.code, "ERR_HTTP_HEADERS_SENT");
  } finally { await new Promise(resolve => server.close(resolve)); }
});
