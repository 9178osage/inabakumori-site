const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const vm = require('node:vm');

function commentElement(hidden = false) {
  return {
    children: [], hidden, listeners: {}, textContent: '', parentElement: null,
    append(...items) { items.forEach(item => this.insertBefore(item, null)); },
    insertBefore(item, before) {
      item.remove();
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, item); item.parentElement = this;
    },
    remove() {
      if (!this.parentElement) return;
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1); this.parentElement = null;
    },
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; }, addEventListener(name, fn) { this.listeners[name] = fn; }
  };
}

test('auth POST throttling covers tenant paths and URL normalization; disabled email-exists API needs no limiter', async () => {
  const express = require('../../backend/node_modules/express');
  const { ipKeyGenerator } = require('../../backend/node_modules/express-rate-limit');
  const { createRequestRateLimit } = await import('../../backend/request-rate-limit.mjs');
  const { IncomingMessage, ServerResponse } = require('node:http');
  const { Duplex } = require('node:stream');
  const app = express();
  const backend = fs.readFileSync('backend/server.mjs', 'utf8');
  const setup = backend.match(/const authSensitiveLimiter =[\s\S]*?(?=app\.use\(middleware\(\)\);)/);
  assert.ok(setup, 'auth limiter must run before the SuperTokens middleware');
  // The limiter block imports its path normaliser from services.mjs; inject the real one instead of
  // duplicating it, so this harness tests the implementation that ships.
  const { normalizeRequestPath } = await import('../../backend/services.mjs');
  vm.runInNewContext(setup[0], { app, createRequestRateLimit, URL, normalizeRequestPath, sharedStore: () => ({}), clientIpKey: req => ipKeyGenerator(req.ip) });
  app.use((req, res) => res.status(204).end());
  const request = async (method, pathname) => {
    const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } });
    Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
    const req = new IncomingMessage(socket);
    req.method = method;
    req.url = pathname;
    req.headers = {};
    const res = new ServerResponse(req);
    try {
      await new Promise((resolve, reject) => {
        res.end = function () { this.emit('finish'); resolve(); return this; };
        app.handle(req, res, reject);
      });
      return res.statusCode;
    } finally {
      socket.destroy();
    }
  };
  assert.doesNotMatch(backend, /emailExistsLimiter/, 'dead email-exists limiter must stay removed');
  assert.match(backend, /delete next\.emailExistsGET;/, 'email-exists API must remain disabled');
  for (let i = 0; i < 12; i++) assert.equal(await request('GET', '/auth/signup/email/exists'), 204);
  for (let i = 0; i < 25; i++) assert.equal(await request('GET', '/auth/signin'), 204);
  const paths = [
    '/auth/signin', '/auth/public/signin', '/auth/public/signup',
    '/auth/public/user/password/reset/token', '/auth/public/user/password/reset',
    '/auth/example-tenant/signin', '/outside/../auth/public/signin',
    '/outside/%2e%2e/auth/public/signin',
    // Doubled and backslash separators must not slip past the limiter.
    '//auth/signin', '///auth//public/signin', '\\auth\\public\\signin'
  ];
  for (let i = 0; i < 20; i++) assert.equal(await request('POST', paths[i % paths.length]), 204);
  for (const pathname of paths) assert.equal(await request('POST', pathname), 429, pathname);
  assert.equal(await request('GET', '/auth/signin'), 204);
  assert.equal(await request('POST', '/api/comments'), 204);
  assert.equal(await request('POST', '/author'), 204);
});

function asynchronousStatements(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return Object.fromEntries(['get', 'all', 'run'].map(method => [method, async (...args) => {
        await new Promise(resolve => setImmediate(resolve));
        return statement[method](...args);
      }]));
    }
  };
}

async function database({ asynchronous = false } = {}) {
  const { registerCommentManagement } = await import('../../backend/services.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE comments(id INTEGER PRIMARY KEY, nickname TEXT, content TEXT, created_at INTEGER, user_id TEXT, is_guest INTEGER)');
  const add = db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?)');
  for (let id = 1; id <= 25; id++) add.run(id, 'test', 'mine', id, 'owner', 0);
  add.run(26, 'other', 'private ownership', 26, 'another-user', 0);
  add.run(27, 'guest', 'guest', 27, null, 1);
  const routes = {};
  const auth = (req, res, next) => next();
  const app = Object.fromEntries(['get', 'delete'].map(method => [method, (path, guard, handler) => {
    assert.equal(guard, auth);
    routes[method] = handler;
  }]));
  registerCommentManagement(app, asynchronous ? asynchronousStatements(db) : db, () => auth);
  const call = async (method, values = {}) => {
    const req = { query: {}, params: {}, session: { getUserId: () => 'owner' }, ...values };
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await routes[method](req, res);
    return res;
  };
  return { db, call };
}
test('own messages are paginated, private and never include other users or guests', async () => {
  const { db, call } = await database();
  try {
    const first = await call('get');
    assert.equal(first.body.comments.length, 20);
    assert.equal(first.headers['Cache-Control'], 'no-store');
    assert.equal(first.body.comments[0].id, 25);
    assert.equal(first.body.nextCursor, 6);
    assert.ok(first.body.comments.every(row => !('user_id' in row)));
    const next = await call('get', { query: { before: first.body.nextCursor } });
    assert.deepEqual(next.body.comments.map(row => row.id), [5,4,3,2,1]);
    assert.equal(next.body.nextCursor, null);
    assert.equal((await call('get', { query: { before: 'bad' } })).code, 400);
  } finally { db.close(); }
});
test('delete checks ownership on the server and rejects guests, missing and invalid IDs', async () => {
  const { db, call } = await database();
  try {
    assert.equal((await call('delete', { params: { id: '26' } })).code, 403);
    assert.equal((await call('delete', { params: { id: '27' } })).code, 403);
    assert.equal((await call('delete', { params: { id: '999' } })).code, 404);
    assert.equal((await call('delete', { params: { id: '-1' } })).code, 400);
    assert.equal((await call('delete', { params: { id: '1' } })).body.deletedCommentId, 1);
    assert.equal(db.prepare('SELECT id FROM comments WHERE id = 1').get(), undefined);
    assert.equal(db.prepare('SELECT count(*) AS n FROM comments WHERE id IN (26,27)').get().n, 2);
  } finally { db.close(); }
});

test('own message management awaits asynchronous database reads and writes', async () => {
  const { db, call } = await database({ asynchronous: true });
  try {
    const page = await call('get');
    assert.equal(page.body.comments[0].id, 25);
    assert.equal(page.body.comments.length, 20);
    assert.equal((await call('delete', { params: { id: '26' } })).code, 403);
    assert.equal((await call('delete', { params: { id: '1' } })).body.deletedCommentId, 1);
    assert.equal(db.prepare('SELECT id FROM comments WHERE id = 1').get(), undefined);
  } finally { db.close(); }
});
test('reset email redirects to the GitHub Pages homepage and keeps the token in the fragment', async () => {
  const { passwordResetDelivery } = await import('../../backend/services.mjs');
  let sent;
  const service = passwordResetDelivery('https://9178osage.github.io/inabakumori-site/').override({ sendEmail: async input => { sent = input; } });
  await service.sendEmail({ passwordResetLink: 'https://site.example/auth/reset-password?token=test-token&rid=emailpassword', tenantId: 'public', type: 'PASSWORD_RESET', user: { email: 'nobody@example.com' } });
  const url = new URL(sent.passwordResetLink);
  assert.equal(url.pathname, '/inabakumori-site/');
  assert.equal(url.origin, 'https://9178osage.github.io');
  assert.equal(url.searchParams.get('resetPassword'), '1');
  assert.equal(url.searchParams.get('token'), null);
  assert.equal(url.searchParams.get('tenantId'), null);
  const fragment = new URLSearchParams(url.hash.slice(1));
  assert.equal(fragment.get('token'), 'test-token');
  assert.equal(fragment.get('tenantId'), 'public');
});
function ui() {
  const element = () => commentElement();
  const elements = Object.fromEntries(['my-comments-list','my-comments-controls','my-comments-status','my-comments-more','my-comments-retry'].map(id => [id, element()]));
  const events = {};
  const removed = [];
  const context = {
    CustomEvent, localStorage: { getItem: () => 'zh' }, confirm: () => true,
    document: { getElementById: id => elements[id], createElement: element, addEventListener(name, fn) { events[name] = fn; } },
    window: { APP_CONFIG: { apiDomain: 'http://localhost' }, hasCommentSession: async () => true, removeWallMessage: id => removed.push(id), addEventListener(name, fn) { events[name] = fn; }, dispatchEvent(event) { events[event.type]?.(event); } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/i18n.js", "utf8"), context);
  vm.runInContext(fs.readFileSync('js/comments.js','utf8'), context);
  return { elements, events, context, removed };
}
test('delete cancellation sends no request and failed deletion leaves the message available', async () => {
  const { elements, context, events, removed } = ui();
  let deletes = 0;
  context.fetch = async (_, options) => {
    if (options.method === 'DELETE') { deletes++; return { ok: false, status: 403 }; }
    return { ok: true, json: async () => ({ comments: [{ id: 1, nickname: 'test', content: '<script>test</script>' }], nextCursor: null }) };
  };
  await events.authchange();
  const button = () => elements['my-comments-list'].children[0].children[1];
  assert.equal(elements['my-comments-list'].children[0].children[0].textContent, 'test：<script>test</script>');
  context.confirm = () => false;
  await button().listeners.click();
  assert.equal(deletes, 0);
  context.confirm = () => true;
  await button().listeners.click();
  assert.equal(deletes, 1);
  assert.equal(elements['my-comments-list'].children.length, 1);
  assert.equal(removed.length, 0);
  // A refused delete (403) is not a lost session: the panel stays on screen and reports the failure.
  assert.equal(elements['my-comments-controls'].hidden, false);
  assert.equal(elements['my-comments-status'].textContent, '删除失败，请重试；登录过期时请重新登录。');
  context.fetch = async () => ({ ok: true });
  await button().listeners.click();
  assert.equal(elements['my-comments-list'].children.length, 0);
  assert.deepEqual(removed, [1]);
});

test('a 403 while loading more keeps the messages on screen and offers a retry', async () => {
  const { elements, context, events } = ui();
  let calls = 0;
  context.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: true, status: 200, json: async () => ({ comments: [{ id: 1, nickname: 'n', content: '第一页' }], nextCursor: 10 }) };
    }
    return { ok: false, status: 403 };
  };
  await events.DOMContentLoaded();
  // dispatchEvent() in the stand-in does not return the listener's promise, so wait for the render.
  for (let wait = 0; wait < 40 && elements['my-comments-list'].children.length === 0; wait++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(elements['my-comments-list'].children.length, 1);
  await elements['my-comments-more'].listeners.click();
  // A refused page request is not a dead session: page 1 stays and the reader can retry.
  assert.equal(elements['my-comments-controls'].hidden, false, '403 must not hide the loaded messages');
  assert.equal(elements['my-comments-list'].children.length, 1);
  assert.equal(elements['my-comments-status'].textContent, '读取失败，请重试。');
  assert.equal(elements['my-comments-retry'].hidden, false, 'the retry button is offered');
  assert.equal(elements['my-comments-more'].hidden, false, 'the cursor is kept for the retry');
});

test('Japanese message management shows a localized sign-in prompt', async () => {
  const { context, elements, events } = ui();
  context.localStorage.getItem = () => 'ja';
  context.window.hasCommentSession = async () => false;
  await events.authchange();
  assert.equal(elements['my-comments-status'].textContent, 'メッセージを管理するにはログインしてください。');
});

test('a stale unauthorized response cannot hide a newer signed-in message list', async () => {
  for (const status of [401, 403]) {
    const { context, elements, events } = ui();
    let resolveStale;
    context.fetch = () => new Promise(resolve => { resolveStale = resolve; });
    const staleLoad = events.authchange();
    await new Promise(resolve => setImmediate(resolve));

    context.fetch = async () => ({ ok: true, json: async () => ({
      comments: [{ id: 2, nickname: 'new account', content: 'current message' }], nextCursor: 2
    }) });
    await events.authchange();
    resolveStale({ ok: false, status });
    await staleLoad;

    assert.equal(elements['my-comments-controls'].hidden, false, `${status} from an old request must not hide the current controls`);
    assert.equal(elements['my-comments-list'].children[0].children[0].textContent, 'new account：current message');
    events.languagechange();
    assert.equal(elements['my-comments-status'].textContent, '', `${status} must not leave stale signed-out state for a later render`);
    assert.equal(elements['my-comments-more'].hidden, false);
    assert.equal(elements['my-comments-more'].attributes['aria-disabled'], 'false');
  }
});

test('comment safety blocks links, contact details and common advertising language', async () => {
  const { detectCommentSafetyIssue, normalizeCommentForComparison } = await import('../../backend/services.mjs');
  for (const content of [
    'http://',
    'https://example.com',
    'https://exam\u200bple.com',
    'ｗｗｗ．example.com',
    'www.example.com',
    '联系 me@example.com',
    '加微信 138-0013-8000',
    '优惠折扣，扫码进群'
  ]) {
    assert.equal(detectCommentSafetyIssue(content)?.code, 'PROMOTIONAL_CONTENT');
  }
  assert.equal(detectCommentSafetyIssue('这首歌的旋律很喜欢'), null);
  assert.equal(detectCommentSafetyIssue('The timeline feels calm'), null);
  assert.equal(normalizeCommentForComparison('  Rain　station\n'), 'rain station');
});

test('admin comment management lists and deletes any comment only for configured admins', async () => {
  const { registerAdminCommentManagement } = await import('../../backend/services.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE comments(id INTEGER PRIMARY KEY, nickname TEXT, content TEXT, created_at INTEGER, user_id TEXT, is_guest INTEGER, expires_at INTEGER)');
  db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(1, 'guest', 'remove me', Date.now(), null, 1, null);
  const routes = {};
  const auth = (req, res, next) => next();
  const app = {
    get(path, ...handlers) { routes[`get ${path}`] = handlers; assert.equal(handlers[0], auth); },
    delete(path, ...handlers) { routes[`delete ${path}`] = handlers; assert.equal(handlers[0], auth); }
  };
  registerAdminCommentManagement(app, db, () => auth, userId => userId === 'admin');
  const response = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const run = async (route, req, res) => {
    let index = 0;
    const next = () => route[index++]?.(req, res, next);
    await next();
  };
  const denied = response();
  await run(routes['get /api/admin/comments'], { session: { getUserId: () => 'member' } }, denied);
  assert.equal(denied.code, 403);
  const allowed = response();
  await run(routes['get /api/admin/comments'], { session: { getUserId: () => 'admin' } }, allowed);
  assert.equal(allowed.body.comments[0].id, 1);
  const insert = db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)');
  for (let id = 2; id <= 122; id++) insert.run(id, 'guest', 'page test', Date.now(), null, 1, id === 122 ? 1 : null);
  const seen = [];
  let cursor;
  do {
    const page = response();
    await run(routes['get /api/admin/comments'], { query: cursor ? { before: cursor } : {}, session: { getUserId: () => 'admin' } }, page);
    assert.ok(page.body.comments.length <= 50);
    seen.push(...page.body.comments.map(comment => comment.id));
    cursor = page.body.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, Array.from({ length: 121 }, (_, i) => 121 - i));
  const invalid = response();
  await run(routes['get /api/admin/comments'], { query: { before: 'bad' }, session: { getUserId: () => 'admin' } }, invalid);
  assert.equal(invalid.code, 400);
  assert.deepEqual(invalid.body, { error: '留言分页参数无效', code: 'INVALID_CURSOR' });
  const removed = response();
  await run(routes['delete /api/admin/comments/:id'], { params: { id: '1' }, session: { getUserId: () => 'admin' } }, removed);
  assert.equal(removed.body.deletedCommentId, 1);
  assert.equal(db.prepare('SELECT id FROM comments WHERE id = 1').get(), undefined);
  db.close();
});

test('admin message management awaits asynchronous database reads and writes', async () => {
  const { registerAdminCommentManagement } = await import('../../backend/services.mjs');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE comments(id INTEGER PRIMARY KEY, nickname TEXT, content TEXT, created_at INTEGER, user_id TEXT, is_guest INTEGER, expires_at INTEGER)');
    db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(1, 'guest', 'remove me', Date.now(), null, 1, null);
    const routes = {};
    const app = {
      get(path, ...handlers) { routes.get = handlers.at(-1); },
      delete(path, ...handlers) { routes.delete = handlers.at(-1); }
    };
    registerAdminCommentManagement(app, asynchronousStatements(db), () => () => {}, async () => true);
    const response = () => ({ code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    const page = response();
    await routes.get({ query: {} }, page);
    assert.deepEqual(page.body.comments.map(comment => [comment.id, comment.isGuest]), [[1, true]]);
    const removed = response();
    await routes.delete({ params: { id: '1' } }, removed);
    assert.equal(removed.body.deletedCommentId, 1);
    assert.equal(db.prepare('SELECT id FROM comments WHERE id = 1').get(), undefined);
    const missing = response();
    await routes.delete({ params: { id: '1' } }, missing);
    assert.equal(missing.code, 404);
  } finally { db.close(); }
});

function adminUi() {
  const element = () => commentElement(true);
  const elements = Object.fromEntries(['admin-comments', 'admin-comments-list', 'admin-comments-status', 'admin-comments-retry'].map(id => [id, element()]));
  const events = {};
  const context = {
    CustomEvent, localStorage: { getItem: () => 'ja' }, confirm: () => true,
    document: { getElementById: id => elements[id], createElement: element, addEventListener(name, fn) { events[name] = fn; } },
    window: { APP_CONFIG: { apiDomain: '' }, hasCommentSession: async () => true, addEventListener(name, fn) { events[name] = fn; }, dispatchEvent(event) { events[event.type]?.(event); } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/i18n.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/comments.js', 'utf8'), context);
  return { elements, events, context };
}

test('comment delete labels use short complete Unicode characters while the full message stays visible', async () => {
  for (const [createUi, listId] of [[ui, 'my-comments-list'], [adminUi, 'admin-comments-list']]) {
    const { elements, events, context } = createUi();
    context.localStorage.getItem = () => 'en';
    const prefix = '雨'.repeat(39);
    const family = '👩‍👩‍👧‍👦';
    const combining = 'e\u0301';
    for (const [content, excerpt] of [
      ['a short message', 'a short message'],
      [prefix + family, prefix + family],
      [prefix + family + 'more', prefix + family + '…'],
      [prefix + combining + 'more', prefix + combining + '…']
    ]) {
      context.fetch = async () => ({ ok: true, json: async () => ({ comments: [{ id: 1, nickname: 'fan', content }] }) });
      await events.authchange();
      const [text, button] = elements[listId].children[0].children;
      assert.equal(text.textContent, `fan：${content}`);
      assert.equal(button.attributes['aria-label'], `Delete this message: ${excerpt}`);
    }
  }
});

test('only the admin list identifies guest and signed-in messages and translates on language change', async () => {
  const comments = [
    { id: 1, nickname: 'guest', content: 'hello', isGuest: true },
    { id: 2, nickname: 'member', content: 'hello', isGuest: false },
    { id: 3, nickname: 'unknown', content: 'hello' }
  ];
  for (const [createUi, listId] of [[ui, 'my-comments-list'], [adminUi, 'admin-comments-list']]) {
    const { elements, events, context } = createUi();
    context.fetch = async () => ({ ok: true, json: async () => ({ comments }) });
    await events.authchange();
    const originalButtons = elements[listId].children.map(row => row.children[1]);
    for (const [language, labels] of [['zh', [' [游客]', ' [已登录]']], ['en', [' [Guest]', ' [Signed in]']], ['ja', [' [ゲスト]', ' [ログイン済み]']]]) {
      context.localStorage.getItem = () => language;
      events.languagechange();
      for (const [index, comment] of comments.entries()) {
        const identity = listId === 'admin-comments-list' ? labels[index] || '' : '';
        const row = elements[listId].children[index];
        assert.equal(row.children[0].textContent, `${comment.nickname}${identity}：hello`);
        assert.equal(row.children[1], originalButtons[index], 'translations preserve the existing delete button');
      }
    }
  }
});

test('admin panel stays hidden for failed permission checks and stale responses after logout', async () => {
  const { elements, events, context } = adminUi();
  context.fetch = async () => { throw new Error('offline'); };
  await events.authchange();
  assert.equal(elements['admin-comments'].hidden, true);
  let resolve;
  context.fetch = () => new Promise(r => { resolve = r; });
  const pending = events.authchange();
  await new Promise(r => setImmediate(r));
  context.window.hasCommentSession = async () => false;
  await events.authchange();
  resolve({ ok: true, json: async () => ({ comments: [] }) });
  await pending;
  assert.equal(elements['admin-comments'].hidden, true);
});
test('admin deletion failures preserve content and translated error; duplicate clicks are blocked', async () => {
  const { elements, events, context } = adminUi();
  context.fetch = async () => ({ ok: true, json: async () => ({ comments: [{ id: 1, nickname: 'test', content: '<b>message</b>' }] }) });
  await events.authchange();
  const button = elements['admin-comments-list'].children[0].children[1];
  let calls = 0, resolve;
  context.fetch = () => { calls++; return new Promise(r => { resolve = r; }); };
  const pending = button.listeners.click();
  await button.listeners.click();
  assert.equal(calls, 1);
  resolve({ ok: false, status: 500 });
  await pending;
  assert.equal(elements['admin-comments-list'].children.length, 1);
  assert.equal(elements['admin-comments-status'].textContent, '削除に失敗しました。再試行してください。');
});

test('admin rights come only from ADMIN_USER_IDS, never from emails', async () => {
  const { parseAdminUserIds, createAdminCheck, buildVersion, detectCommentSafetyIssue } = await import('../../backend/services.mjs');
  const ids = parseAdminUserIds(' d1ec4565-3063-4f7c-acd5-eb9d141482d6 , ,other-id ');
  assert.deepEqual([...ids], ['d1ec4565-3063-4f7c-acd5-eb9d141482d6', 'other-id']);
  const isAdmin = createAdminCheck(ids);
  assert.equal(await isAdmin('d1ec4565-3063-4f7c-acd5-eb9d141482d6'), true);
  assert.equal(await isAdmin('other-id'), true);
  for (const value of ['D1EC4565-3063-4F7C-ACD5-EB9D141482D6', 'admin@example.com', '', undefined, null, 'd1ec4565']) assert.equal(await isAdmin(value), false);
  assert.equal(await createAdminCheck(parseAdminUserIds(''))('anyone'), false);
  assert.equal(await createAdminCheck(parseAdminUserIds(undefined))(''), false);
  const server = require('node:fs').readFileSync('backend/server.mjs', 'utf8');
  assert.doesNotMatch(server, /ADMIN_EMAILS\s*=|hasVerifiedAdminEmail|supertokens\.getUser\(/);
  assert.match(server, /registerAdminCommentManagement\(app, db, verifySession, createAdminCheck\(ADMIN_USER_IDS\)\)/);
  assert.match(server, /ADMIN_USER_IDS is empty/);
  assert.equal(buildVersion({ RAILWAY_GIT_COMMIT_SHA: '7270D91ABCDEF0123456789abcdef0123456789a' }), '7270d91');
  assert.equal(buildVersion({ VERCEL_GIT_COMMIT_SHA: 'ABC1234abc1234', RAILWAY_GIT_COMMIT_SHA: '7270d91' }), 'abc1234');
  assert.equal(buildVersion({ VERCEL_GIT_COMMIT_SHA: 'invalid', RAILWAY_GIT_COMMIT_SHA: '7270d91' }), '7270d91');
  for (const sha of [undefined, '', 'main', '<script>', '123']) assert.equal(buildVersion({ RAILWAY_GIT_COMMIT_SHA: sha }), 'dev');
  for (const message of ['手机上听这首歌很喜欢', '邮箱收不到邮件', '希望不要有广告', '微信里朋友推荐了这首歌']) assert.equal(detectCommentSafetyIssue(message), null);
  for (const message of ['加微信 abc123', '微信：abc123', 'qq号:123456', '扫码领取优惠']) assert.equal(detectCommentSafetyIssue(message)?.code, 'PROMOTIONAL_CONTENT');
});

test('deployment preserves the frontend subpath and keeps SQLite inside the volume', async () => {
  const { websiteLocation, resolveDatabasePath, passwordResetDelivery } = await import('../../backend/services.mjs');
  const website = websiteLocation('https://9178osage.github.io/inabakumori-site/');
  assert.equal(website.origin, 'https://9178osage.github.io');
  let delivered;
  await passwordResetDelivery(website.url).override({ sendEmail: async input => { delivered = input; } }).sendEmail({ passwordResetLink: 'https://api.example/auth/reset-password?token=test', tenantId: 'public' });
  const resetUrl = new URL(delivered.passwordResetLink);
  assert.equal(resetUrl.pathname, '/inabakumori-site/');
  assert.equal(resetUrl.searchParams.get('token'), null);
  assert.equal(new URLSearchParams(resetUrl.hash.slice(1)).get('token'), 'test');
  assert.throws(() => websiteLocation('file:///tmp/index.html'));
  assert.throws(() => websiteLocation('http://user:secret@example.com/'));
  assert.equal(resolveDatabasePath({}, '/app/backend'), '/app/backend/comments.db');
  assert.equal(resolveDatabasePath({ NODE_ENV: 'production', RAILWAY_VOLUME_MOUNT_PATH: '/data' }, '/app/backend'), '/data/comments.db');
  assert.throws(() => resolveDatabasePath({ NODE_ENV: 'production' }, '/app/backend'));
  assert.throws(() => resolveDatabasePath({ NODE_ENV: 'production', RAILWAY_SERVICE_ID: 'test-service', COMMENTS_DB_PATH: '/data/comments.db' }, '/app/backend'), /Attach a Railway volume/);
  assert.throws(() => resolveDatabasePath({ NODE_ENV: 'production', RAILWAY_VOLUME_MOUNT_PATH: './data' }, '/app/backend'), /must be absolute/);
  assert.equal(resolveDatabasePath({ NODE_ENV: 'production', RAILWAY_SERVICE_ID: 'test-service', RAILWAY_VOLUME_MOUNT_PATH: '/data', COMMENTS_DB_PATH: '/data/comments.db' }, '/app/backend'), '/data/comments.db');
  assert.throws(() => resolveDatabasePath({ NODE_ENV: 'production', COMMENTS_DB_PATH: './comments.db' }, '/app/backend'));
  assert.throws(() => resolveDatabasePath({ RAILWAY_VOLUME_MOUNT_PATH: '/data', COMMENTS_DB_PATH: '/data-other/comments.db' }, '/app/backend'));
  for (const env of [{ VERCEL: '1' }, { VERCEL: '1', COMMENTS_DB_PATH: '/tmp/comments.db', DATABASE_URL: 'libsql://example.test' }]) {
    assert.throws(() => resolveDatabasePath(env, '/app/backend'), /Vercel requires a persistent remote database/);
  }
});

test('admin deletion remains applied when a concurrent refresh returns stale data', async () => {
  const { elements, events, context } = adminUi();
  const row = { id: 1, nickname: 'test', content: 'message' };
  context.fetch = async () => ({ ok: true, json: async () => ({ comments: [row] }) });
  await events.authchange();
  let finishDelete, finishLoad;
  context.fetch = (_, options) => new Promise(resolve => {
    if (options.method === 'DELETE') finishDelete = resolve;
    else finishLoad = resolve;
  });
  const deletion = elements['admin-comments-list'].children[0].children[1].listeners.click();
  const refresh = events.commentposted();
  await new Promise(resolve => setImmediate(resolve));
  finishDelete({ ok: true });
  await deletion;
  finishLoad({ ok: true, json: async () => ({ comments: [row] }) });
  await refresh;
  assert.equal(elements['admin-comments-list'].children.length, 0);
});

function combinedCommentUi() {
  const element = () => commentElement(true);
  const elements = Object.fromEntries([
    'my-comments-list', 'my-comments-controls', 'my-comments-status', 'my-comments-more', 'my-comments-retry',
    'admin-comments', 'admin-comments-list', 'admin-comments-status', 'admin-comments-retry', 'admin-comments-more'
  ].map(id => [id, element()]));
  const events = {}, listeners = {};
  const listen = (name, fn) => {
    (listeners[name] ||= []).push(fn);
    events[name] = event => Promise.all(listeners[name].map(listener => listener(event)));
  };
  const context = {
    CustomEvent, localStorage: { getItem: () => 'en' }, confirm: () => true,
    document: { getElementById: id => elements[id], createElement: element, addEventListener: listen },
    window: {
      APP_CONFIG: { apiDomain: '' }, hasCommentSession: async () => true,
      addEventListener: listen, dispatchEvent: event => events[event.type]?.(event)
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/comments.js', 'utf8'), context);
  return { elements, events, context };
}

for (const sourcePanel of ['my-comments', 'admin-comments']) {
  test(`${sourcePanel} deletion updates both panels and survives their in-flight refreshes`, async () => {
    const { elements, events, context } = combinedCommentUi();
    const row = { id: 1, nickname: 'admin', content: 'my own message' };
    const response = () => ({ ok: true, json: async () => ({ comments: [row], nextCursor: null }) });
    context.fetch = async () => response();
    await events.authchange();
    assert.equal(elements['my-comments-list'].children.length, 1);
    assert.equal(elements['admin-comments-list'].children.length, 1);

    let finishDelete;
    const pendingLoads = [];
    context.fetch = (_, options) => new Promise(resolve => {
      if (options.method === 'DELETE') finishDelete = resolve;
      else pendingLoads.push(resolve);
    });
    const deletion = elements[`${sourcePanel}-list`].children[0].children[1].listeners.click();
    const refresh = events.commentposted();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pendingLoads.length, 2);
    finishDelete({ ok: true });
    await deletion;
    assert.equal(elements['my-comments-list'].children.length, 0);
    assert.equal(elements['admin-comments-list'].children.length, 0);

    pendingLoads.forEach(resolve => resolve(response()));
    await refresh;
    assert.equal(elements['my-comments-list'].children.length, 0);
    assert.equal(elements['admin-comments-list'].children.length, 0);
  });
}

test('deletion notifications after sign-out cannot reveal either management panel', async () => {
  const { elements, events, context } = combinedCommentUi();
  context.fetch = async () => ({ ok: true, json: async () => ({ comments: [{ id: 1, nickname: 'admin', content: 'message' }], nextCursor: null }) });
  await events.authchange();
  context.window.hasCommentSession = async () => false;
  await events.authchange();
  await context.window.dispatchEvent(new CustomEvent('commentdeleted', { detail: { id: 1 } }));
  assert.equal(elements['my-comments-controls'].hidden, true);
  assert.equal(elements['admin-comments'].hidden, true);
  assert.equal(elements['my-comments-list'].children.length, 0);
  assert.equal(elements['admin-comments-list'].children.length, 0);
});

test('duplicate comments are scoped to the signed-in account and expire after ten minutes', async () => {
  const { createRecentDuplicateChecker } = await import('../../backend/services.mjs');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE comments(content TEXT, user_id TEXT, is_guest INTEGER, created_at INTEGER, expires_at INTEGER)');
    const now = 1800000000000;
    const insert = db.prepare('INSERT INTO comments(content, user_id, is_guest, created_at) VALUES(?,?,?,?)');
    insert.run('  Great　song!  ', 'alice', 0, now - 1000);
    insert.run('old comment', 'alice', 0, now - 600000);
    insert.run('guest comment', null, 1, now);
    const duplicate = createRecentDuplicateChecker(db);
    assert.equal(duplicate('great song!', 'alice', now), true);
    assert.equal(duplicate('great song!', 'bob', now), false);
    assert.equal(duplicate('great song!', null, now), false);
    assert.equal(duplicate('guest comment', null, now), true);
    assert.equal(duplicate('guest comment', 'alice', now), false);
    assert.equal(duplicate('old comment', 'alice', now), false);
    assert.equal(duplicate('another song', 'alice', now), false);
  } finally { db.close(); }
});

test('guest same-text dedup uses a short global window and ignores member posts', async () => {
  const { createRecentDuplicateChecker } = await import('../../backend/services.mjs');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE comments(content TEXT, user_id TEXT, is_guest INTEGER, created_at INTEGER, expires_at INTEGER)');
    const now = 1800000000000;
    const insert = db.prepare('INSERT INTO comments(content, user_id, is_guest, created_at) VALUES(?,?,?,?)');
    insert.run('  Nice　track  ', null, 1, now - 60_000);
    insert.run('Nice track', 'member', 0, now - 30_000);
    insert.run('stale guest', null, 1, now - 6 * 60_000);
    const duplicate = createRecentDuplicateChecker(db);
    assert.equal(duplicate('nice track', null, now), true);
    assert.equal(duplicate('nice track', 'other', now), false);
    assert.equal(duplicate('stale guest', null, now), false);
    assert.equal(duplicate('brand new', null, now), false);
  } finally { db.close(); }
});

test('ordinary friendship comments pass while contact and promotional content remain blocked', async () => {
  const { detectCommentSafetyIssue } = await import('../../backend/services.mjs');
  for (const content of ['加好友', '想和喜欢这首歌的人加好友', '大家可以一起聊音乐']) {
    assert.equal(detectCommentSafetyIssue(content), null, content);
  }
  for (const content of ['加好友，微信：abc123', '加好友 me@example.com', '加好友 https://example.com', '加好友，优惠折扣', '加好友 13800138000']) {
    assert.equal(detectCommentSafetyIssue(content)?.code, 'PROMOTIONAL_CONTENT', content);
  }
});

test('phone filter ignores long plain numbers and dotted IPs but still blocks phone-like contact', async () => {
  const { detectCommentSafetyIssue } = await import('../../backend/services.mjs');
  for (const content of ['听了1000000次', '听了1234567遍', '192.168.1.1 这个地址', '版本号 20240928']) {
    assert.equal(detectCommentSafetyIssue(content), null, content);
  }
  for (const content of ['138-0013-8000', '+86 13800138000', '+8613800138000', '010-1234-5678']) {
    assert.equal(detectCommentSafetyIssue(content)?.code, 'PROMOTIONAL_CONTENT', content);
  }
});

test('wechat and qq colloquial bypasses are blocked without catching ordinary friendship talk', async () => {
  const { detectCommentSafetyIssue } = await import('../../backend/services.mjs');
  for (const content of ['加个微信 abc123', '加一下微信 abc', '加一下我的微信 hello', '加QQ 123456', 'vx:abc_1', 'wx：test_01']) {
    assert.equal(detectCommentSafetyIssue(content)?.code, 'PROMOTIONAL_CONTENT', content);
  }
  for (const content of ['加好友', '想和喜欢这首歌的人加好友', '微信里朋友推荐了这首歌']) {
    assert.equal(detectCommentSafetyIssue(content), null, content);
  }
});

test('helmet keeps an explicit API CSP instead of disabling it', () => {
  const source = fs.readFileSync('backend/server.mjs', 'utf8');
  assert.match(source, /contentSecurityPolicy\s*:\s*\{/);
  assert.doesNotMatch(source, /contentSecurityPolicy\s*:\s*false/);
  assert.match(source, /defaultSrc:\s*\["'none'"\]/);
});

test('unknown non-API backend paths return a JSON 404 before the error handlers', () => {
  const backend = fs.readFileSync('backend/server.mjs', 'utf8');
  const apiNotFound = backend.indexOf('app.use("/api", (req, res) => {');
  const catchAll = backend.indexOf('app.use((req, res) => {\n  res.status(404).json({ error: "请求的地址不存在，请刷新页面后重试", code: "NOT_FOUND" });');
  const errors = backend.indexOf('app.use(errorHandler());');
  assert.ok(apiNotFound > 0 && catchAll > apiNotFound && errors > catchAll, 'catch-all JSON 404 must sit after /api 404 and before errorHandler');
});

test('a successful password reset revokes every existing session of that user', async () => {
  const backend = fs.readFileSync('backend/server.mjs', 'utf8');
  assert.match(backend, /delete next\.emailExistsGET;/, 'email-exists API must remain disabled');
  assert.match(backend, /next\.passwordResetPOST = revokeSessionsAfterPasswordReset\(original\.passwordResetPOST, userId => Session\.revokeAllSessionsForUser\(userId\)\)/,
    'password reset must be wrapped so it revokes all sessions');
  const { revokeSessionsAfterPasswordReset } = await import('../../backend/services.mjs');
  const logs = [];
  const log = { warn: (...args) => logs.push(['warn', ...args]), error: (...args) => logs.push(['error', ...args]) };
  const input = { token: 'secret-reset-token-123', tenantId: 'public', formFields: [{ id: 'password', value: 'NewPassw0rd!' }] };
  const run = async (result, revoke) => {
    const revoked = [];
    const wrapped = revokeSessionsAfterPasswordReset(async received => { assert.equal(received, input); return result; },
      revoke || (async userId => { revoked.push(userId); return ['handle']; }), log);
    return { response: await wrapped(input), revoked };
  };
  const ok = { status: 'OK', email: 'fan@example.com', user: { id: 'user-1' } };
  let outcome = await run(ok);
  assert.equal(outcome.response, ok);
  assert.deepEqual(outcome.revoked, ['user-1']);
  // A transient hiccup between this process and the Core is retried once, not silently dropped.
  let attempts = 0;
  outcome = await run(ok, async userId => {
    if (++attempts === 1) throw Object.assign(new Error('blip'), { code: 'ECONNRESET' });
    return [userId];
  });
  assert.equal(outcome.response, ok);
  assert.equal(attempts, 2, 'revocation is retried once on a transient failure');
  for (const status of ['RESET_PASSWORD_INVALID_TOKEN_ERROR', 'PASSWORD_POLICY_VIOLATED_ERROR', 'GENERAL_ERROR']) {
    const failed = { status };
    outcome = await run(failed);
    assert.equal(outcome.response, failed);
    assert.deepEqual(outcome.revoked, [], `${status} must not revoke sessions`);
  }
  assert.equal(logs.length, 0);
  outcome = await run({ status: 'OK', email: 'fan@example.com' });
  assert.deepEqual(outcome.revoked, [], 'a missing user is handled without throwing');
  assert.equal(logs.at(-1)[0], 'warn');
  const failure = Object.assign(new Error('core unreachable secret-reset-token-123'), { code: 'ECONNREFUSED' });
  outcome = await run(ok, async () => { throw failure; });
  assert.equal(outcome.response, ok, 'a revocation failure must not turn a completed reset into an error');
  assert.equal(logs.at(-1)[0], 'error');
  assert.doesNotMatch(JSON.stringify(logs), /secret-reset-token-123|NewPassw0rd|fan@example\.com/, 'logs must not contain tokens, passwords or emails');
  await assert.rejects(revokeSessionsAfterPasswordReset(async () => { throw new Error('boom'); }, async () => {}, log)(input), /boom/,
    'errors from the reset itself still propagate to the SuperTokens error handler');
});

test('the global limiter runs before CORS, and duplicate guest posts count against the guest quota', async () => {
  const backend = fs.readFileSync('backend/server.mjs', 'utf8');
  const limiterAt = backend.indexOf('app.use(requestLimiter);');
  const corsAt = backend.indexOf('corsMiddleware(req, res, next));');
  assert.ok(limiterAt > 0 && corsAt > limiterAt, 'preflights and rejected origins must be rate limited too');
  assert.ok(limiterAt < backend.indexOf('app.use(requireJsonRequestBody);') && limiterAt < backend.indexOf('app.use(middleware());'));
  assert.ok(backend.indexOf('app.use("/api", commentReadLimiter);') > corsAt, 'the /api read limiter keeps its CORS headers');
  const definition = backend.match(/const guestCommentLimiter = createRequestRateLimit\(\{[^\n]*\}\);/);
  assert.ok(definition, 'guest limiter definition');
  const express = require('../../backend/node_modules/express');
  const { ipKeyGenerator } = require('../../backend/node_modules/express-rate-limit');
  const { createRequestRateLimit } = await import('../../backend/request-rate-limit.mjs');
  const guestCommentLimiter = vm.runInNewContext(`${definition[0]}; guestCommentLimiter`, { createRequestRateLimit, sharedStore: () => ({}), clientIpKey: req => ipKeyGenerator(req.ip) });
  const app = express();
  app.post('/comments/:status', guestCommentLimiter, (req, res) => res.status(Number(req.params.status)).json({}));
  const server = app.listen(0, '127.0.0.1');
  await require('node:events').once(server, 'listening');
  try {
    const post = async status => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/comments/${status}`, { method: 'POST' });
      await response.arrayBuffer();
      return response.status;
    };
    const statuses = [];
    for (const status of [400, 400, 400, 201, 409, 409, 409, 201]) statuses.push(await post(status));
    // Invalid input stays free; a created post and duplicates use the 3-per-hour quota.
    assert.deepEqual(statuses, [400, 400, 400, 201, 409, 409, 429, 429]);
  } finally {
    server.close();
  }
});
