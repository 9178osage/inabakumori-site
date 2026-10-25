const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const express = require("../../backend/node_modules/express");

const TOKEN = "a".repeat(16) + "0123456789abcdef0123456789abcdef";
const ABORT_TOKEN = "c".repeat(48);

function listenOnLoopback(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", error => {
      if (error) return reject(error);
      resolve(server);
    });
  });
}

async function trackBackups(databasePath, options = {}) {
  const { backupDatabase } = await import("../../backend/backup.mjs");
  const snapshots = [], completions = [];
  return {
    snapshots, completions,
    options: {
      ...options,
      async snapshot(destination) {
        snapshots.push(destination);
        return options.snapshot ? options.snapshot(destination) : backupDatabase(databasePath, destination);
      },
      onBackgroundTask(task) {
        completions.push(task);
        options.onBackgroundTask?.(task);
      }
    }
  };
}

function holdStreamAfterFirstWrite(app) {
  let release = () => {};
  app.use((_req, res, next) => {
    const write = res.write;
    const emit = res.emit;
    let held = true, first = true;
    // Backpressure is an explicit server-side barrier. Client pause alone does
    // not prove that the server has not already filled its socket buffers.
    res.emit = function (event, ...args) {
      if (held && event === "drain") return false;
      return emit.call(this, event, ...args);
    };
    res.write = function (...args) {
      const result = write.apply(this, args);
      if (first) { first = false; return false; }
      return result;
    };
    release = () => {
      if (!held) return;
      held = false;
      res.write = write;
      res.emit = emit;
      emit.call(res, "drain");
    };
    next();
  });
  return () => release();
}

function pausedBackup(server) {
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.get({ host: "127.0.0.1", port: server.port, path: "/api/admin/backup", headers: { Authorization: `Bearer ${ABORT_TOKEN}` } }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error("Expected a successful synthetic backup response")); return; }
      res.once("data", () => { res.pause(); resolve(res); });
      res.once("end", () => reject(new Error("Synthetic snapshot ended before the pause barrier")));
      res.on("error", reject);
    });
    request.on("error", reject);
  });
  return { request, response };
}

test("a failed listener preserves the original error before reading its address", async () => {
  const failure = Object.assign(new Error("Synthetic listener permission denied"), { code: "EPERM" });
  let addressReads = 0;
  const app = {
    listen(port, host, callback) {
      assert.equal(port, 0);
      assert.equal(host, "127.0.0.1");
      queueMicrotask(() => callback(failure));
      return { address() { addressReads++; return null; } };
    }
  };
  await assert.rejects(async () => {
    const server = await listenOnLoopback(app);
    return server.address().port;
  }, error => error === failure, "the caller receives the original Error, not an address TypeError");
  assert.equal(addressReads, 0, "an unsuccessful listener has no address to inspect");
});

async function serve(token) {
  const { registerBackupEndpoint } = await import("../../backend/backup-endpoint.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  const databasePath = path.join(dir, "comments.db");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE comments (id INTEGER PRIMARY KEY, content TEXT); INSERT INTO comments (content) VALUES ('hello');");
  db.close();
  const logs = [];
  const log = { log: (...a) => logs.push(JSON.stringify(a)), warn: (...a) => logs.push(JSON.stringify(a)) };
  const app = express();
  const tracking = await trackBackups(databasePath);
  registerBackupEndpoint(app, { databasePath, token, limiter: (_req, _res, next) => next(), log, ...tracking.options });
  app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND" }));
  const server = await listenOnLoopback(app);
  const url = `http://127.0.0.1:${server.address().port}/api/admin/backup`;
  return { url, logs, dir, snapshots: tracking.snapshots, completions: tracking.completions,
    async close() { await new Promise(resolve => server.close(resolve)); await Promise.all(tracking.completions); } };
}

test("backup token must be at least 32 characters, otherwise the endpoint is disabled", async () => {
  const { backupTokenFrom, bearerMatches, backupFilename, isBackupPath } = await import("../../backend/backup-endpoint.mjs");
  assert.equal(backupTokenFrom({}), null);
  assert.equal(backupTokenFrom({ BACKUP_TOKEN: "x".repeat(31) }), null);
  assert.equal(backupTokenFrom({ BACKUP_TOKEN: ` ${TOKEN} ` }), TOKEN);
  assert.equal(bearerMatches(`Bearer ${TOKEN}`, TOKEN), true);
  for (const header of [undefined, "", TOKEN, `Basic ${TOKEN}`, `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, `Bearer  ${TOKEN}`]) assert.equal(bearerMatches(header, TOKEN), false, String(header));
  assert.equal(bearerMatches(`Bearer ${TOKEN}`, null), false);
  assert.equal(backupFilename(new Date("2026-10-11T08:00:00Z")), "comments-20261011.db");
  assert.equal(isBackupPath("/API/Admin/Backup/?x=1"), true);
  assert.equal(isBackupPath("/api/admin/comments"), false);
  assert.match(fs.readFileSync("backend/backup-endpoint.mjs", "utf8"), /timingSafeEqual\(given, expected\)/);
});

test("disabled endpoint returns 404 even with a bearer header", async () => {
  const s = await serve(null);
  try {
    assert.equal((await fetch(s.url, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
    assert.equal((await fetch(s.url, { method: "HEAD", headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("HEAD is rejected with the allowed method before opening the snapshot source", async () => {
  const s = await serve(TOKEN);
  try {
    fs.unlinkSync(path.join(s.dir, "comments.db"));
    const response = await fetch(s.url, { method: "HEAD", headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
    assert.deepEqual(s.logs, [], "HEAD must not try to serve a backup");
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("wrong or missing token is rejected; a valid snapshot cleans up while another backup remains active", async () => {
  const s = await serve(TOKEN);
  let other, paused;
  try {
    other = await serveBackup({ holdStream: true });
    paused = pausedBackup(other);
    await paused.response;
    assert.equal(other.snapshots.length, 1);
    assert.equal(fs.existsSync(other.snapshots[0]), true);
    const unauthenticated = await fetch(s.url);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("x-backend-node-version"), null);
    assert.equal((await fetch(s.url, { headers: { Authorization: "Bearer " + "b".repeat(48) } })).status, 401);
    const res = await fetch(s.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-backend-node-version"), process.version);
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.subarray(0, 16).toString("latin1"), "SQLite format 3\0");
    const copy = path.join(s.dir, "downloaded.db");
    fs.writeFileSync(copy, body);
    const check = new DatabaseSync(copy, { readOnly: true });
    assert.equal(check.prepare("SELECT content FROM comments").get().content, "hello");
    check.close();
    assert.equal(s.snapshots.length, 1, "only the authorized request creates a snapshot");
    assert.equal(s.completions.length, 1);
    await Promise.all(s.completions);
    assert.equal(fs.existsSync(path.dirname(s.snapshots[0])), false, "this request's private snapshot directory is removed");
    assert.equal(fs.existsSync(other.snapshots[0]), true, "another backup's active snapshot does not affect this request's cleanup check");
    assert.ok(s.logs.length >= 3);
    assert.ok(s.logs.every(line => !line.includes(TOKEN)), "token never logged");
  } finally {
    paused?.request.destroy();
    other?.releaseStream();
    await Promise.all([...s.completions, ...(other?.completions || [])]);
    await Promise.all([s.close(), other?.close()]);
    fs.rmSync(s.dir, { recursive: true, force: true });
    if (other) fs.rmSync(other.dir, { recursive: true, force: true });
  }
});

async function serveBackup(options = {}) {
  const { registerBackupEndpoint } = await import("../../backend/backup-endpoint.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-abort-test-"));
  const databasePath = path.join(dir, "comments.db");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE comments (id INTEGER PRIMARY KEY, content BLOB)");
  // Use multiple read-stream chunks; the server gate controls pause/abort timing.
  const insert = db.prepare("INSERT INTO comments (content) VALUES (randomblob(?))");
  for (let i = 0; i < 8; i++) insert.run(1024 * 1024);
  db.close();
  const logs = [];
  const log = { log: (...a) => logs.push(["log", ...a]), warn: (...a) => logs.push(["warn", ...a]) };
  const app = express();
  const { holdStream, ...endpointOptions } = options;
  const releaseStream = holdStream ? holdStreamAfterFirstWrite(app) : () => {};
  const tracking = await trackBackups(databasePath, endpointOptions);
  registerBackupEndpoint(app, { databasePath, token: ABORT_TOKEN, limiter: (_req, _res, next) => next(), log, ...tracking.options });
  const server = await listenOnLoopback(app);
  return { port: server.address().port, logs, dir, releaseStream, snapshots: tracking.snapshots, completions: tracking.completions,
    async close() { releaseStream(); await new Promise(resolve => server.close(resolve)); await Promise.all(tracking.completions); } };
}

test("1: 'Backup served' is logged only after the whole snapshot was sent", async () => {
  const s = await serveBackup();
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/api/admin/backup`, { headers: { Authorization: `Bearer ${ABORT_TOKEN}` } });
    assert.equal(res.status, 200);
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.length, Number(res.headers.get("content-length")));
    await Promise.all(s.completions);
    assert.deepEqual(s.logs.map(entry => entry[1]), ["Backup served"]);
    assert.equal(s.logs[0][2].size, body.length);
  } finally { await s.close(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test("1: a client that aborts mid-download is logged as aborted, never as served", async () => {
  const s = await serveBackup({ holdStream: true });
  const paused = pausedBackup(s);
  try {
    await paused.response;
    paused.request.destroy();
    await Promise.all(s.completions);
    assert.equal(s.logs[0][0], "warn");
    assert.equal(s.logs[0][1], "Backup aborted");
    assert.ok(!s.logs.some(entry => entry[1] === "Backup served"));
  } finally {
    paused.request.destroy();
    s.releaseStream();
    await Promise.all(s.completions);
    await s.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("the background completion hook covers streaming and temp-directory removal on success or disconnect", async t => {
  const { backupDatabase } = await import("../../backend/backup.mjs");
  for (const disconnect of [false, true]) {
    await t.test(disconnect ? "client disconnect" : "successful download", async () => {
      let destination;
      let completion;
      let settled = false;
      let registrations = 0;
      const s = await serveBackup({
        holdStream: true,
        async snapshot(file) {
          destination = file;
          assert.equal(registrations, 1, "the invocation must be retained before snapshot work begins");
          await backupDatabase(path.join(s.dir, "comments.db"), file);
        },
        onBackgroundTask(task) {
          registrations++;
          assert.ok(task instanceof Promise);
          completion = task.then(() => {
            assert.equal(fs.existsSync(path.dirname(destination)), false, "completion resolves only after the private temp directory is gone");
            settled = true;
          });
        }
      });
      const paused = pausedBackup(s);
      try {
        const response = await paused.response;
        assert.equal(registrations, 1);
        assert.equal(settled, false, "a partially consumed response still owns its background task");
        assert.equal(fs.existsSync(destination), true, "the snapshot remains available while its stream is active");
        if (disconnect) paused.request.destroy();
        else {
          s.releaseStream();
          await new Promise((resolve, reject) => {
            response.once("end", resolve);
            response.once("error", reject);
            response.resume();
          });
        }
        await completion;
        assert.equal(settled, true);
      } finally {
        paused.request.destroy();
        s.releaseStream();
        try { await completion; }
        finally {
          await s.close();
          fs.rmSync(s.dir, { recursive: true, force: true });
        }
      }
    });
  }
});

