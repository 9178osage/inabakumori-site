const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { gzipSync } = require("node:zlib");
const express = require("../../backend/node_modules/express");
const typeIs = require("../../backend/node_modules/type-is");
const { assertThatBodyParserHasBeenUsedForExpressLikeRequest: sdkParse } =
  require("../../backend/node_modules/supertokens-node/lib/build/framework/utils.js");

// Exercise the installed Express and SuperTokens parsers without an HTTP listener,
// real auth service, credentials, or production database.
async function parseRequest(data, headers) {
  const { requireJsonRequestBody } = await import("../../backend/services.mjs");
  const req = Readable.from(data.length ? [data] : []);
  req.method = "POST";
  req.headers = headers;
  req.is = type => typeIs(req, type);
  let sdkReached = false;
  let status = 200;
  let response;
  const res = {
    status(value) { status = value; return this; },
    json(value) { response = value; return this; }
  };
  try {
    let accepted = false;
    requireJsonRequestBody(req, res, () => { accepted = true; });
    if (!accepted) return { status, response, sdkReached };
    const error = await new Promise(resolve => {
      express.json({ limit: "20kb", strict: true })(req, res, resolve);
    });
    if (error) return { status: error.status, errorType: error.type, sdkReached };
    sdkReached = true;
    await sdkParse("post", req);
    return { status, body: req.body, sdkReached };
  } finally {
    req.destroy();
  }
}

test("non-JSON and missing content types cannot reach SuperTokens' unbounded body fallback", async () => {
  const raw = Buffer.from(JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024), formFields: [] }));
  for (const contentType of [undefined, "text/plain", "application/x-www-form-urlencoded", "application/problem+json"]) {
    for (const compression of ["identity", "gzip"]) {
      const data = compression === "gzip" ? gzipSync(raw) : raw;
      const headers = { "content-length": String(data.length), "content-encoding": compression };
      if (contentType) headers["content-type"] = contentType;
      const result = await parseRequest(data, headers);
      assert.equal(result.status, 415, `${contentType}, ${compression}`);
      assert.equal(result.response.code, "UNSUPPORTED_MEDIA_TYPE");
      assert.equal(result.sdkReached, false);
    }
  }
});

test("chunked non-JSON bodies cannot bypass the parser boundary", async () => {
  const result = await parseRequest(Buffer.from('{"formFields":[]}'), { "transfer-encoding": "chunked" });
  assert.equal(result.status, 415);
  assert.equal(result.sdkReached, false);
});

test("JSON bodies still enforce the 20 KB limit after decompression and with chunked transfer", async () => {
  const raw = Buffer.from(JSON.stringify({ padding: "x".repeat(32 * 1024) }));
  for (const compression of ["identity", "gzip"]) {
    const data = compression === "gzip" ? gzipSync(raw) : raw;
    for (const framing of [{ "content-length": String(data.length) }, { "transfer-encoding": "chunked" }]) {
      const result = await parseRequest(data, { ...framing, "content-type": "application/json", "content-encoding": compression });
      assert.equal(result.status, 413);
      assert.equal(result.errorType, "entity.too.large");
      assert.equal(result.sdkReached, false);
    }
  }
});

test("small JSON requests and bodyless session operations remain compatible with SuperTokens", async () => {
  const body = { formFields: [{ id: "email", value: "user@example.test" }] };
  const data = Buffer.from(JSON.stringify(body));
  const parsed = await parseRequest(data, { "content-type": "application/json", "content-length": String(data.length) });
  assert.equal(parsed.status, 200);
  assert.equal(parsed.sdkReached, true);
  assert.deepEqual(parsed.body, body);
  for (const headers of [{}, { "content-length": "0" }]) {
    const empty = await parseRequest(Buffer.alloc(0), headers);
    assert.equal(empty.status, 200);
    assert.equal(empty.sdkReached, true);
    assert.deepEqual(empty.body, {});
  }
});
