const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const vm = require('node:vm');

async function database() {
  const { registerCommentManagement } = await import('../backend/services.mjs');
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
  registerCommentManagement(app, db, () => auth);
  const call = (method, values = {}) => {
    const req = { query: {}, params: {}, session: { getUserId: () => 'owner' }, ...values };
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    routes[method](req, res);
    return res;
  };
  return { db, call };
}
test('own messages are paginated, private and never include other users or guests', async () => {
  const { db, call } = await database();
  try {
    const first = call('get');
    assert.equal(first.body.comments.length, 20);
    assert.equal(first.headers['Cache-Control'], 'no-store');
    assert.equal(first.body.comments[0].id, 25);
    assert.equal(first.body.nextCursor, 6);
    assert.ok(first.body.comments.every(row => !('user_id' in row)));
    const next = call('get', { query: { before: first.body.nextCursor } });
    assert.deepEqual(next.body.comments.map(row => row.id), [5,4,3,2,1]);
    assert.equal(next.body.nextCursor, null);
    assert.equal(call('get', { query: { before: 'bad' } }).code, 400);
  } finally { db.close(); }
});
test('delete checks ownership on the server and rejects guests, missing and invalid IDs', async () => {
  const { db, call } = await database();
  try {
    assert.equal(call('delete', { params: { id: '26' } }).code, 403);
    assert.equal(call('delete', { params: { id: '27' } }).code, 403);
    assert.equal(call('delete', { params: { id: '999' } }).code, 404);
    assert.equal(call('delete', { params: { id: '-1' } }).code, 400);
    assert.equal(call('delete', { params: { id: '1' } }).body.deletedCommentId, 1);
    assert.equal(db.prepare('SELECT id FROM comments WHERE id = 1').get(), undefined);
    assert.equal(db.prepare('SELECT count(*) AS n FROM comments WHERE id IN (26,27)').get().n, 2);
  } finally { db.close(); }
});
test('reset email redirects to the static homepage with original token and tenant', async () => {
  const { passwordResetDelivery } = await import('../backend/services.mjs');
  let sent;
  const service = passwordResetDelivery('https://site.example').override({ sendEmail: async input => { sent = input; } });
  await service.sendEmail({ passwordResetLink: 'https://site.example/auth/reset-password?token=test-token&rid=emailpassword', tenantId: 'public', type: 'PASSWORD_RESET', user: { email: 'nobody@example.com' } });
  const url = new URL(sent.passwordResetLink);
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('resetPassword'), '1');
  assert.equal(url.searchParams.get('token'), 'test-token');
  assert.equal(url.searchParams.get('tenantId'), 'public');
});
function ui() {
  function element() { return { children: [], hidden: false, listeners: {}, textContent: '', append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; }, setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; } }; }
  const elements = Object.fromEntries(['my-comments-list','my-comments-controls','my-comments-status','my-comments-more','my-comments-retry'].map(id => [id, element()]));
  const events = {};
  const removed = [];
  const context = {
    localStorage: { getItem: () => 'zh' }, confirm: () => true,
    document: { getElementById: id => elements[id], createElement: element, addEventListener(name, fn) { events[name] = fn; } },
    window: { APP_CONFIG: { apiDomain: 'http://localhost' }, hasCommentSession: async () => true, removeWallMessage: id => removed.push(id), addEventListener(name, fn) { events[name] = fn; } }
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
  context.fetch = async () => ({ ok: true });
  await button().listeners.click();
  assert.equal(elements['my-comments-list'].children.length, 0);
  assert.deepEqual(removed, [1]);
});

test('Japanese message management shows a localized sign-in prompt', async () => {
  const { context, elements, events } = ui();
  context.localStorage.getItem = () => 'ja';
  context.window.hasCommentSession = async () => false;
  await events.authchange();
  assert.equal(elements['my-comments-status'].textContent, 'メッセージを管理するにはログインしてください。');
});

test('comment safety blocks links, contact details and common advertising language', async () => {
  const { detectCommentSafetyIssue, normalizeCommentForComparison } = await import('../backend/services.mjs');
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
  const { registerAdminCommentManagement } = await import('../backend/services.mjs');
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
  const removed = response();
  await run(routes['delete /api/admin/comments/:id'], { params: { id: '1' }, session: { getUserId: () => 'admin' } }, removed);
  assert.equal(removed.body.deletedCommentId, 1);
  assert.equal(db.prepare('SELECT id FROM comments WHERE id = 1').get(), undefined);
  db.close();
});

function adminUi() {
  const element = () => ({ hidden: true, children: [], textContent: '', listeners: {}, append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; }, setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
  const elements = Object.fromEntries(['admin-comments', 'admin-comments-list', 'admin-comments-status', 'admin-comments-retry'].map(id => [id, element()]));
  const events = {};
  const context = {
    localStorage: { getItem: () => 'ja' }, confirm: () => true,
    document: { getElementById: id => elements[id], createElement: element, addEventListener(name, fn) { events[name] = fn; } },
    window: { APP_CONFIG: { apiDomain: '' }, hasCommentSession: async () => true, addEventListener(name, fn) { events[name] = fn; } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/i18n.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/comments.js', 'utf8'), context);
  return { elements, events, context };
}
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

test('admin email grants require a verified matching login method', async () => {
  const { hasVerifiedAdminEmail, detectCommentSafetyIssue } = await import('../backend/services.mjs');
  const emails = new Set(['admin@example.com']);
  assert.equal(hasVerifiedAdminEmail({ emails: ['admin@example.com'], loginMethods: [{ email: 'admin@example.com', verified: false }] }, emails), false);
  assert.equal(hasVerifiedAdminEmail({ loginMethods: [{ email: 'other@example.com', verified: true }, { email: 'admin@example.com', verified: false }] }, emails), false);
  assert.equal(hasVerifiedAdminEmail({ loginMethods: [{ email: 'ADMIN@example.com', verified: true }] }, emails), true);
  assert.equal(hasVerifiedAdminEmail(undefined, emails), false);
  for (const message of ['手机上听这首歌很喜欢', '邮箱收不到邮件', '希望不要有广告', '微信里朋友推荐了这首歌']) assert.equal(detectCommentSafetyIssue(message), null);
  for (const message of ['加微信 abc123', '微信：abc123', 'qq号:123456', '扫码领取优惠']) assert.equal(detectCommentSafetyIssue(message)?.code, 'PROMOTIONAL_CONTENT');
});
