const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const vm = require('node:vm');
const { once } = require('node:events');

const backend = fs.readFileSync('backend/server.mjs', 'utf8');
async function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const call = async (method, path) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
    await response.arrayBuffer();
    return response.status;
  };
  return { call, close: () => server.close() };
}
async function limiterTools() {
  const express = require('../../backend/node_modules/express');
  const { ipKeyGenerator } = require('../../backend/node_modules/express-rate-limit');
  const { createRequestRateLimit } = await import('../../backend/request-rate-limit.mjs');
  return { express, createRequestRateLimit, clientIpKey: req => ipKeyGenerator(req.ip) };
}

test('one hourly per-IP budget covers guest and member comments together', async () => {
  const definition = backend.match(/const ipHourlyCommentLimiter = createRequestRateLimit\(\{[^\n]*\}\);/);
  assert.ok(definition, 'per-IP hourly comment limiter definition');
  assert.match(backend, /app\.post\("\/api\/comments", commentLimiter, requireJsonContentType, verifySession\(\{ sessionRequired: false \}\), ipHourlyCommentLimiter, guestCommentLimiter, memberCommentLimiter,/);
  const { express, createRequestRateLimit, clientIpKey } = await limiterTools();
  const ipHourlyCommentLimiter = vm.runInNewContext(`${definition[0]}; ipHourlyCommentLimiter`, { createRequestRateLimit, sharedStore: () => ({}), clientIpKey });
  const app = express();
  // Alternate "accounts": the key is the IP, so switching account or guest status does not reset it.
  app.post('/comments/:who/:status', ipHourlyCommentLimiter, (req, res) => res.status(Number(req.params.status)).json({}));
  const { call, close } = await serve(app);
  try {
    assert.equal(await call('POST', '/comments/guest/400'), 400, 'invalid input stays free');
    for (let i = 0; i < 29; i++) assert.equal(await call('POST', `/comments/member-${i}/201`), 201);
    assert.equal(await call('POST', '/comments/guest/409'), 409, 'a duplicate still counts');
    assert.equal(await call('POST', '/comments/member-new/201'), 429);
    assert.equal(await call('POST', '/comments/guest/201'), 429);
  } finally { close(); }
});

test('sign-up has its own stricter hourly limit, tenant paths included, without starving sign-in', async () => {
  const setup = backend.match(/const authSensitiveLimiter =[\s\S]*?(?=app\.use\(middleware\(\)\);)/);
  assert.ok(setup);
  assert.match(setup[0], /const signupLimiter = createRequestRateLimit\(\{[^\n]*windowMs: 60 \* 60 \* 1e3, limit: 5,/);
  const { express, createRequestRateLimit, clientIpKey } = await limiterTools();
  const { normalizeRequestPath } = await import('../../backend/services.mjs');
  const app = express();
  vm.runInNewContext(setup[0], { app, createRequestRateLimit, URL, normalizeRequestPath, sharedStore: () => ({}), clientIpKey });
  app.use((req, res) => res.status(204).end());
  const { call, close } = await serve(app);
  try {
    for (let i = 0; i < 3; i++) assert.equal(await call('POST', '/auth/signup'), 204);
    for (let i = 0; i < 2; i++) assert.equal(await call('POST', '/auth/public/signup'), 204);
    assert.equal(await call('POST', '/auth/signup'), 429);
    assert.equal(await call('POST', '/auth/public/signup'), 429);
    assert.equal(await call('POST', '/auth/SIGNUP'), 429, 'case spellings share the budget');
    assert.equal(await call('POST', '/auth/signin'), 204, 'sign-in keeps the separate shared auth budget');
    assert.equal(await call('GET', '/auth/signup'), 204, 'only POST is limited');
  } finally { close(); }
});

test('admins can delete every comment by the author of one member comment, never guests or admins', async () => {
  const { registerAdminCommentManagement } = await import('../../backend/services.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE comments(id INTEGER PRIMARY KEY, nickname TEXT, content TEXT, created_at INTEGER, user_id TEXT, is_guest INTEGER, expires_at INTEGER)');
  const insert = db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)');
  insert.run(1, 'spam', 'a', Date.now(), 'spammer', 0, null);
  insert.run(2, 'other', 'b', Date.now(), 'member', 0, null);
  insert.run(3, 'spam2', 'c', Date.now(), 'spammer', 0, null);
  insert.run(4, 'guest', 'd', Date.now(), null, 1, Date.now() + 1e9);
  insert.run(5, 'owner', 'e', Date.now(), 'admin', 0, null);
  const routes = {};
  const auth = (req, res, next) => next();
  const app = { get() {}, delete(path, ...handlers) { routes[path] = handlers; assert.equal(handlers[0], auth); } };
  let purges = 0;
  registerAdminCommentManagement(app, db, () => auth, userId => userId === 'admin', () => { purges++; });
  const route = routes['/api/admin/comments/:id/author'];
  assert.ok(route, 'author deletion route');
  const call = async (id, userId = 'admin') => {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const req = { params: { id }, session: { getUserId: () => userId } };
    let index = 0;
    const next = () => route[index++]?.(req, res, next);
    await next();
    return res;
  };
  assert.equal((await call('1', 'member')).code, 403, 'members cannot use it');
  assert.equal((await call('bad')).code, 400);
  assert.equal((await call('99')).code, 404);
  assert.deepEqual((await call('4')).body.code, 'GUEST_HAS_NO_ACCOUNT');
  assert.deepEqual((await call('5')).body.code, 'ADMIN_AUTHOR');
  assert.equal(purges, 0);
  const done = await call('3');
  assert.deepEqual(done.body, { success: true, deletedCommentIds: [3, 1], deletedCount: 2 });
  assert.equal(JSON.stringify(done.body).includes('spammer'), false, 'the account ID never leaves the server');
  assert.deepEqual(db.prepare('SELECT id FROM comments ORDER BY id').all().map(row => row.id), [2, 4, 5]);
  assert.equal(purges, 1);
  db.close();
});

test('the moderation panel offers per-user deletion only on member comments and removes every returned ID', () => {
  const source = fs.readFileSync('js/comments.js', 'utf8');
  assert.match(source, /if \(removeAuthor && comment\.isGuest === false && comment\.isAdmin !== true\)/);
  assert.match(source, /`\$\{api\}\/\$\{id\}\/author`, \{ method: "DELETE", credentials: "include" \}/);
  assert.match(source, /for \(const removed of ids\) \{\n\s+deleted\.add\(removed\);\n\s+window\.removeWallMessage\?\.\(removed\);/);
  assert.match(source, /renderList\(comments, deleting, label, remove, removeAuthor\);/);
  assert.match(source, /commentListView\("my-comments-list", "my-comments-status"\);/);
});

test('password-reset emails are limited per address and answer OK without revealing the limit (audit B3)', async () => {
  const definition = backend.match(/const PASSWORD_RESET_TOKEN_PATH =[\s\S]*?\n\}\);\n/);
  assert.ok(definition, 'per-email reset limiter block');
  assert.ok(backend.indexOf('const PASSWORD_RESET_TOKEN_PATH') < backend.indexOf('app.use(middleware());'), 'must run before SuperTokens');
  const { express, createRequestRateLimit } = await limiterTools();
  const { normalizeRequestPath, passwordResetEmailKey } = await import('../../backend/services.mjs');
  const app = express();
  app.use(express.json());
  vm.runInNewContext(definition[0], { app, createRequestRateLimit, normalizeRequestPath, passwordResetEmailKey, sharedStore: () => ({}) });
  let sent = 0;
  app.use((req, res) => { sent++; res.json({ status: 'OK' }); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const post = async (path, email) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formFields: [{ id: 'email', value: email }] }) });
    return { status: response.status, body: await response.json(), headers: [...response.headers.keys()].filter(name => /ratelimit|retry-after/i.test(name)) };
  };
  try {
    for (let i = 0; i < 3; i++) assert.equal((await post('/auth/user/password/reset/token', 'victim@example.com')).status, 200);
    assert.equal(sent, 3);
    for (const [path, email] of [['/auth/user/password/reset/token', ' Victim@Example.com '], ['/auth/public/user/password/reset/token', 'victim@example.com']]) {
      const over = await post(path, email);
      assert.deepEqual([over.status, over.body, over.headers], [200, { status: 'OK' }, []], 'over the limit looks exactly like success');
    }
    assert.equal(sent, 3, 'no further reset emails reach SuperTokens');
    assert.equal((await post('/auth/user/password/reset/token', 'other@example.com')).status, 200);
    assert.equal(sent, 4, 'other addresses keep their own budget');
    assert.equal((await post('/auth/signin', 'victim@example.com')).status, 200);
    assert.equal(sent, 5, 'other auth routes are untouched');
  } finally { server.close(); }
  assert.equal(passwordResetEmailKey({}), null);
  assert.equal(passwordResetEmailKey({ formFields: [{ id: 'email', value: 7 }] }), null);
  assert.doesNotMatch(passwordResetEmailKey({ formFields: [{ id: 'email', value: 'a@b.c' }] }), /a@b/, 'only a hash is stored');
});
