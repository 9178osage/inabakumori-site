"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const PRIVATE = "synthetic-youtube-private-value";
const ORIGINAL = 'const SONGS = [{"title":"Synthetic song","youtube":"https://youtu.be/AAAAAAAAAAA","viewCount":7,"viewsCheckedAt":"2020-01-01"}];\n';

function runRefresh(input) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-diagnostics-"));
  try {
    fs.mkdirSync(path.join(root, "tools"));
    fs.mkdirSync(path.join(root, "js"));
    for (const file of ["refresh-youtube-views.mjs", "safe-fs.mjs"]) {
      fs.copyFileSync(path.join(ROOT, "tools", file), path.join(root, "tools", file));
    }
    fs.writeFileSync(path.join(root, "js/songs.js"), ORIGINAL);
    fs.writeFileSync(path.join(root, "mock.mjs"), `
import { writeFileSync } from "node:fs";
const input = JSON.parse(process.env.YOUTUBE_TEST_CASE);
const token = process.env.YOUTUBE_API_KEY;
if (input.mode === "stall") {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  AbortSignal.timeout = milliseconds => {
    if (milliseconds !== 15000) throw new Error("Unexpected request deadline");
    return originalTimeout(40);
  };
}
globalThis.fetch = async (url, options) => {
  if (String(url).includes(token) || options.headers["X-Goog-Api-Key"] !== token) {
    throw new Error("Unsafe credential transport");
  }
  if (!options.signal) throw new Error("Missing request deadline");
  if (input.mode === "network") throw new Error(token);
  if (input.mode === "stall") {
    let keepAlive;
    return new Response(new ReadableStream({
      start() { keepAlive = setInterval(() => {}, 100); },
      cancel() { clearInterval(keepAlive); writeFileSync("cancelled", "yes"); }
    }), { status: 400 });
  }
  if (input.mode === "oversized" || input.mode === "chunked-oversized") {
    const bytes = new TextEncoder().encode(JSON.stringify({ error: { errors: [{ reason: "keyInvalid" }], message: token + "x".repeat(20000) } }));
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        const end = Math.min(bytes.length, offset + (input.mode === "oversized" ? bytes.length : 1000));
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
      cancel() { writeFileSync("cancelled", "yes"); }
    }), { status: 400 });
  }
  const body = input.mode === "invalid-json" ? "<html>" + token : JSON.stringify(input.body);
  return new Response(body, { status: input.status || 400 });
};
`);
    const result = spawnSync(process.execPath, ["--import", path.join(root, "mock.mjs"), path.join(root, "tools/refresh-youtube-views.mjs")], {
      cwd: root, encoding: "utf8", timeout: 3000,
      env: { ...process.env, YOUTUBE_API_KEY: PRIVATE, YOUTUBE_TEST_CASE: JSON.stringify(input) }
    });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /synthetic-youtube-private-value|PRIVATE_PROJECT|PRIVATE_MESSAGE|private\.invalid/u);
    return {
      status: result.status,
      output,
      songs: fs.readFileSync(path.join(root, "js/songs.js"), "utf8"),
      cancelled: fs.existsSync(path.join(root, "cancelled"))
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function privateError(extra) {
  return { error: {
    message: "PRIVATE_MESSAGE " + PRIVATE,
    ...extra
  } };
}

test("YouTube diagnostics identify invalid and expired API keys without exposing the response", () => {
  for (const reason of ["keyInvalid", "keyExpired"]) {
    const result = runRefresh({ body: privateError({ errors: [{ reason, message: PRIVATE, location: "https://private.invalid" }] }) });
    assert.equal(result.status, 1);
    assert.equal(result.songs, ORIGINAL);
    assert.match(result.output, new RegExp(`HTTP 400; reason=${reason}`, "u"));
    assert.match(result.output, /GitHub Actions YOUTUBE_API_KEY secret/u);
  }
});

test("YouTube diagnostics read Google ErrorInfo identifiers and ignore metadata", () => {
  for (const [reason, hint] of [
    ["API_KEY_INVALID", /valid Google API key/u],
    ["SERVICE_DISABLED", /YouTube Data API v3 is enabled/u],
    ["API_KEY_SERVICE_BLOCKED", /key's API restrictions/u],
    ["API_KEY_HTTP_REFERRER_BLOCKED", /compatible with the GitHub Actions runner/u],
    ["API_KEY_IP_ADDRESS_BLOCKED", /compatible with the GitHub Actions runner/u]
  ]) {
    const result = runRefresh({ status: 403, body: privateError({
      status: "PERMISSION_DENIED",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, metadata: { consumer: "PRIVATE_PROJECT", key: PRIVATE, url: "https://private.invalid" } }]
    }) });
    assert.equal(result.status, 1);
    assert.equal(result.songs, ORIGINAL);
    assert.match(result.output, new RegExp(`reason=${reason}; status=PERMISSION_DENIED`, "u"));
    assert.match(result.output, hint);
  }
});

test("YouTube diagnostics distinguish quota, rate limits, and invalid request parameters", () => {
  for (const [reason, hint] of [
    ["quotaExceeded", /YouTube API quota/u],
    ["dailyLimitExceeded", /quota resets/u],
    ["rateLimitExceeded", /Wait before retrying/u],
    ["invalidParameter", /videos\.list parameters/u]
  ]) {
    const result = runRefresh({ status: 403, body: privateError({ errors: [{ reason }] }) });
    assert.equal(result.status, 1);
    assert.equal(result.songs, ORIGINAL);
    assert.match(result.output, new RegExp(`reason=${reason}`, "u"));
    assert.match(result.output, hint);
  }
});

test("YouTube diagnostics require exact identifiers in the expected fields", () => {
  for (const extra of [
    { errors: [{ reason: "keyInvalid " + PRIVATE }], status: "INVALID_ARGUMENT " + PRIVATE },
    { errors: [{ reason: "UNRECOGNIZED_REASON" }], status: "UNRECOGNIZED_STATUS" },
    { details: [{ "@type": "type.googleapis.com/google.rpc.DebugInfo", reason: "API_KEY_INVALID" }] },
    { reason: "keyInvalid", metadata: { reason: "keyInvalid" } }
  ]) {
    const result = runRefresh({ body: privateError(extra) });
    assert.equal(result.status, 1);
    assert.equal(result.songs, ORIGINAL);
    assert.match(result.output, /YouTube API HTTP 400/u);
    assert.doesNotMatch(result.output, /reason=|status=|UNRECOGNIZED/u);
  }
});

test("YouTube diagnostics safely fall back on invalid, oversized, and interrupted error bodies", () => {
  for (const mode of ["invalid-json", "oversized", "chunked-oversized", "network", "stall"]) {
    const result = runRefresh({ mode });
    assert.equal(result.status, 1, mode);
    assert.equal(result.songs, ORIGINAL, mode);
    assert.doesNotMatch(result.output, /reason=|status=/u, mode);
    if (mode === "stall") assert.match(result.output, /request timed out/u);
    else if (mode === "network") assert.match(result.output, /request failed/u);
    else assert.match(result.output, /HTTP 400/u);
    if (["oversized", "chunked-oversized", "stall"].includes(mode)) assert.equal(result.cancelled, true, mode);
  }
});

test("YouTube error-shaped 200 responses use the same redacted diagnostic and leave songs intact", () => {
  const result = runRefresh({ status: 200, body: privateError({ errors: [{ reason: "keyInvalid" }], status: "INVALID_ARGUMENT" }) });
  assert.equal(result.status, 1);
  assert.equal(result.songs, ORIGINAL);
  assert.match(result.output, /reported an error; reason=keyInvalid; status=INVALID_ARGUMENT/u);
});

test("YouTube diagnostics preserve a successful statistics refresh", () => {
  const result = runRefresh({ status: 200, body: { items: [{ id: "AAAAAAAAAAA", statistics: { viewCount: "10" } }] } });
  assert.equal(result.status, 0, result.output);
  assert.match(result.songs, /"viewCount": 10/u);
  assert.match(result.songs, new RegExp(`"viewsCheckedAt": "${new Date().toISOString().slice(0, 10)}"`, "u"));
});
