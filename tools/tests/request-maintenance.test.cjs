const test = require("node:test");
const assert = require("node:assert/strict");

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("concurrent requests proceed immediately while one retained maintenance task is pending", async () => {
  const { createRequestMaintenance } = await import("../../backend/request-maintenance.mjs");
  const gate = deferred();
  const tasks = [];
  let calls = 0, nextCalls = 0, clock = 0;
  const middleware = createRequestMaintenance({ env: {}, now: () => clock,
    work() { calls++; return gate.promise; }, onBackgroundTask: task => tasks.push(task) });
  const request = () => middleware({ method: "GET" }, {}, () => { nextCalls++; return "response continues"; });
  for (let index = 0; index < 100; index++) assert.equal(request(), "response continues");
  assert.equal(nextCalls, 100);
  assert.equal(tasks.length, 1, "all overlapping requests retain the same single task");
  assert.equal(calls, 0, "work starts after the synchronous request continuation");
  let completed = false;
  tasks[0].then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(completed, false);
  clock = 2 * 60 * 60 * 1000;
  request();
  assert.equal(tasks.length, 1, "even a long-running task prevents another start");
  gate.resolve();
  await tasks[0];
  assert.equal(completed, true);
});

test("successful maintenance waits one hour from completion before a request can start the next task", async () => {
  const { createRequestMaintenance } = await import("../../backend/request-maintenance.mjs");
  const first = deferred(), tasks = [];
  let clock = 0, calls = 0;
  const middleware = createRequestMaintenance({ env: {}, now: () => clock,
    work() { calls++; return calls === 1 ? first.promise : undefined; }, onBackgroundTask: task => tasks.push(task) });
  const request = () => middleware({}, {}, () => {});
  request();
  await Promise.resolve();
  clock = 500;
  first.resolve();
  await tasks[0];
  clock = 60 * 60 * 1000;
  request();
  clock = 60 * 60 * 1000 + 499;
  request();
  assert.equal(tasks.length, 1);
  clock++;
  request();
  await tasks[1];
  assert.equal(calls, 2);
});

test("failed or throwing maintenance is contained, redacted and retried after a short backoff", async () => {
  const { createRequestMaintenance } = await import("../../backend/request-maintenance.mjs");
  const tasks = [], logs = [];
  const failure = Object.assign(new Error("postgres://private-user:private-password@private-host/comments"), { code: "ECONNREFUSED" });
  let clock = 0, calls = 0, nextCalls = 0;
  const middleware = createRequestMaintenance({ env: {}, now: () => clock, retryMs: 100,
    work() {
      calls++;
      if (calls === 1) throw failure;
      if (calls === 2) return Promise.reject(failure);
    },
    onBackgroundTask: task => tasks.push(task), log: { error: (...values) => logs.push(values) } });
  const request = () => middleware({}, {}, error => { assert.equal(error, undefined); nextCalls++; });
  request();
  await assert.doesNotReject(tasks[0]);
  clock = 99;
  request();
  assert.equal(tasks.length, 1);
  clock = 100;
  request();
  await assert.doesNotReject(tasks[1]);
  clock = 199;
  request();
  assert.equal(tasks.length, 2);
  clock = 200;
  request();
  await tasks[2];
  assert.equal(calls, 3);
  assert.equal(nextCalls, 5);
  assert.deepEqual(logs, Array.from({ length: 2 }, () => ["Request maintenance failed", { name: "Error", code: "ECONNREFUSED" }]));
  assert.doesNotMatch(JSON.stringify(logs), /private-user|private-password|private-host|postgres:/u);
});

test("the read-only switch pauses new maintenance without consuming its next eligible run", async () => {
  const { createRequestMaintenance } = await import("../../backend/request-maintenance.mjs");
  const env = { COMMENTS_READ_ONLY: "1" }, tasks = [];
  let calls = 0, nextCalls = 0;
  const middleware = createRequestMaintenance({ env, now: () => 100,
    work() { calls++; }, onBackgroundTask: task => tasks.push(task) });
  const request = () => middleware({}, {}, () => { nextCalls++; });
  request();
  request();
  assert.equal(tasks.length, 0);
  env.COMMENTS_READ_ONLY = "0";
  request();
  await tasks[0];
  assert.equal(calls, 1);
  assert.equal(nextCalls, 3);
});

test("hook or logger failures cannot hold a request or expose an unhandled job rejection", async () => {
  const { createRequestMaintenance } = await import("../../backend/request-maintenance.mjs");
  const tasks = [];
  let nextCalls = 0;
  const middleware = createRequestMaintenance({ env: {}, now: () => 0,
    work() { throw new Error("private database error"); },
    onBackgroundTask(task) { tasks.push(task); throw new Error("hook unavailable"); },
    log: { error() { throw new Error("logger unavailable"); } } });
  assert.doesNotThrow(() => middleware({}, {}, () => { nextCalls++; }));
  await assert.doesNotReject(tasks[0]);
  assert.equal(nextCalls, 1);
});
