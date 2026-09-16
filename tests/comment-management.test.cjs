const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const vm = require('node:vm');

async function database() {
  const { registerCommentManagement } = await import('../backend/comment-management.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE comments(id INTEGER PRIMARY KEY, nickname TEXT, content TEXT, created_at INTEGER, user_id TEXT, is_guest INTEGER)');
  const add = db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?)');
  for (let id = 1; id <= 25; id++) add.run(id, 'test', 'mine', id, 'owner', 0);
  add.run(26, 'other', 'private ownership', 26, 'another-user', 0);
  add.run(27, 'guest', 'guest', 27, null, 1);
  const routes = {};
  const auth = () => {};
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
  const { passwordResetDelivery } = await import('../backend/password-reset.mjs');
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
  vm.runInContext(fs.readFileSync('js/comments-management.js','utf8'), context);
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
