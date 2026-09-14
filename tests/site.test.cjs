const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const source = fs.readFileSync("script.js", "utf8");
function setup(options = {}) {
  const elements = {};
  const messages = [];
  const events = [];
  const context = { console: { log() {
  }, error() {
  } }, localStorage: { getItem: () => null, setItem() {
  } }, document: { documentElement: {}, addEventListener() {
  }, getElementById: (id) => elements[id], querySelector: (selector) => elements[selector], querySelectorAll: (selector) => selector.startsWith(".floating-message") ? messages : [] }, window: { APP_CONFIG: { apiDomain: "http://localhost:3001" }, addEventListener() {
  }, dispatchEvent: (e) => events.push(e.type) }, setInterval() {
  }, Event: class {
    constructor(type) {
      this.type = type;
    }
  }, alert: (text) => events.push(text) };
  Object.assign(context.window, options.window);
  if (options.Image) context.Image = options.Image;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, messages, events, run: (code) => vm.runInContext(code, context) };
}
test("Other toggles off and keeps matching after language changes", () => {
  const { elements, run } = setup();
  const input = elements["tag-filter-input"] = { value: "", focus() {
  } };
  run('currentLanguage="en"; updateTagFilter=()=>{}; toggleTagInInput("其他",getTagInputLabel("其他"))');
  assert.equal(input.value, "Other");
  assert.equal(run('parseTagQuery("Other").plain[0]'), "其他");
  run('currentLanguage="zh"');
  assert.equal(run('songMatchesTags(["其他"],parseTagQuery("Other"))'), true);
  run('toggleTagInInput("其他",getTagInputLabel("其他"))');
  assert.equal(input.value, "");
});
test("submission prevents duplicates, preserves new typing, and unlocks after errors", async () => {
  const { elements, context, run, events } = setup();
  elements["message-name"] = { value: "tester" };
  elements["message-input"] = { value: "first message" };
  const button = elements[".message-box button"] = {};
  let requests = 0, resolve;
  context.fetch = () => {
    requests++;
    return new Promise((r) => resolve = r);
  };
  run("createFloatingMessage=()=>{}");
  const first = run("addMessage()");
  await run("addMessage()");
  assert.equal(requests, 1);
  assert.equal(button.disabled, true);
  elements["message-input"].value = "new draft";
  resolve({ ok: true, json: async () => ({ comment: { id: 1 } }) });
  await first;
  assert.equal(elements["message-input"].value, "new draft");
  assert.equal(button.disabled, false);
  elements["message-name"].value = "tester";
  context.fetch = async () => ({ ok: false, json: async () => ({ error: "RATE LIMITED" }) });
  await run("addMessage()");
  assert.equal(events.at(-1), "RATE LIMITED");
  assert.equal(button.disabled, false);
  assert.equal(elements["message-input"].value, "new draft");
});
test("SQL excludes expired guests while retaining members and active guests", () => {
  const backend = fs.readFileSync("backend/server.mjs", "utf8");
  const sql = backend.match(/const selectRecentCommentsStatement = db.prepare\(`([\s\S]*?)`\)/)[1];
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE comments (id INTEGER, nickname TEXT, content TEXT, is_guest INTEGER, created_at INTEGER, expires_at INTEGER);
            INSERT INTO comments VALUES (1,'a','expired',1,1,100), (2,'b','active',1,2,101), (3,'c','member',0,3,NULL);`);
    assert.deepEqual(db.prepare(sql).all(100, 100).map((row) => row.id), [3, 2]);
  } finally {
    db.close();
  }
});
test("expired messages are removed and track records released", () => {
  const { run, elements, context, messages } = setup();
  const wall = elements["floating-wall"] = { clientWidth: 900, clientHeight: 650, appendChild(element) {
    element.isConnected = true;
    messages.push(element);
  } };
  context.document.createElement = () => ({ dataset: {}, style: {}, offsetWidth: 150, offsetHeight: 40, isConnected: false, animate(_, options) {
    return { currentTime: 0, effect: { getTiming: () => options }, cancel() {
    } };
  }, remove() {
    this.isConnected = false;
    messages.splice(messages.indexOf(this), 1);
  } });
  run('createFloatingMessage({nickname:"a",content:"expired",expiresAt:new Date(0).toISOString()})');
  assert.equal(messages.length, 0);
  run('createFloatingMessage({nickname:"a",content:"live",expiresAt:new Date(Date.now()+60000).toISOString()})');
  assert.equal(run("messageTracks.length"), 1);
  messages[0].dataset.expiresAt = "0";
  run("removeExpiredMessages()");
  assert.equal(messages.length, 0);
  assert.equal(run("messageTracks.length"), 0);
});
test("language refresh updates document and existing messages", () => {
  const { run, context, messages, events } = setup();
  let refreshed = false;
  messages.push({ refreshLanguage() {
    refreshed = true;
  } });
  run('currentLanguage="en"; applyLanguage()');
  assert.equal(context.document.documentElement.lang, "en");
  assert.equal(refreshed, true);
  assert.ok(events.includes("languagechange"));
});
test("all listed hero images exist and switching works immediately", () => {
  const { run, context, elements } = setup();
  context.Image = class {
  };
  const slide = elements["hero-slide"] = {};
  for (const path of run("heroImages")) assert.ok(fs.existsSync(path), path);
  run("changeHeroSlide()");
  assert.equal(slide.src, "images/hero/002.png");
});
test("configuration supports local development and same-origin hosting", () => {
  for (const [hostname, protocol, expected] of [["localhost", "http:", "http://localhost:3001"], ["127.0.0.1", "http:", "http://127.0.0.1:3001"], ["fans.example", "https:", "https://fans.example"]]) {
    const context = { window: { location: { hostname, protocol, origin: `${protocol}//${hostname}` } } };
    vm.runInNewContext(fs.readFileSync("config.js", "utf8"), context);
    assert.equal(context.window.APP_CONFIG.apiDomain, expected);
  }
});
test("empty message wall stays empty without samples", async () => {
  const { elements, context, run } = setup();
  elements["floating-wall"] = {};
  const rendered = [];
  context.capture = (message) => rendered.push(message);
  run("createFloatingMessage=capture");
  context.fetch = async () => ({ ok: true, json: async () => ({ comments: [] }) });
  await run("loadMessages()");
  assert.equal(rendered.length, 0);
});
test("unified search matches titles and tags with required keywords", () => {
  const { elements, context, run } = setup();
  const songs = [{ dataset: { songTitle: "ラグトレイン" }, _songTags: ["歌爱雪"], textContent: "18　ラグトレイン" }, { dataset: { songTitle: "ハルノ寂寞" }, _songTags: ["弦卷真纪"], textContent: "19　ハルノ寂寞" }];
  const tags = elements["tag-filter-input"] = { value: "ラグ" };
  elements[".song-library"] = { classList: { toggle() {
  } } };
  const empty = elements["tag-empty-state"] = {};
  const count = elements["tag-result-count"] = {};
  context.document.querySelectorAll = (selector) => selector === ".song-scroll a" ? songs : [];
  run("updateTagFilter()");
  assert.deepEqual(songs.map((song) => song.hidden), [false, true]);
  assert.equal(count.textContent, "显示 1 / 2 首");
  tags.value = "ラグ, +maki";
  run("updateTagFilter()");
  assert.ok(songs.every((song) => song.hidden));
  assert.equal(empty.hidden, false);
  tags.value = "maki";
  run("updateTagFilter()");
  assert.deepEqual(songs.map((song) => song.hidden), [true, false]);
  tags.value = "";
  run("updateTagFilter()");
  assert.ok(songs.every((song) => !song.hidden));
  assert.equal(songs[0].textContent, "18　ラグトレイン");
  assert.equal(run('songMatchesTitle("ラグトレイン", "  ﾗｸﾞ  ")'), true);
  assert.equal(run('songMatchesTitle("Song (album ver.)", "ALBUM")'), true);
});
test("late load preserves old and newly posted messages", async () => {
  const { elements, context, run } = setup();
  elements["floating-wall"] = {};
  elements["message-name"] = { value: "tester" };
  elements["message-input"] = { value: "new message" };
  const rendered = new Map();
  context.capture = (message) => rendered.set(message.id, message);
  context.document.querySelectorAll = (selector) => selector === ".floating-message" ? [...rendered.keys()].map((id) => ({ disposeMessage() {
    rendered.delete(id);
  } })) : [];
  run("createFloatingMessage=capture");
  let finishLoad;
  context.fetch = (_, options) => options.method === "POST" ? Promise.resolve({ ok: true, json: async () => ({ comment: { id: 2, content: "new message" } }) }) : new Promise((resolve) => finishLoad = resolve);
  const loading = run("loadMessages()");
  await run("addMessage()");
  finishLoad({ ok: true, json: async () => ({ comments: [{ id: 1, content: "old message" }] }) });
  await loading;
  assert.deepEqual([...rendered.keys()], [1, 2]);
});
test("failed load shows retry and successful retry clears it", async () => {
  const { elements, context, run } = setup();
  elements["floating-wall"] = {};
  const status = elements["message-load-status"] = {};
  const retry = elements["message-retry"] = {};
  context.fetch = async () => {
    throw Error("offline");
  };
  await run("loadMessages()");
  assert.equal(retry.hidden, false);
  assert.match(status.textContent, /加载失败/);
  run('currentLanguage="en"; updateMessageLoadStatus()');
  assert.match(status.textContent, /Could not load/);
  context.fetch = async () => ({ ok: true, json: async () => ({ comments: [] }) });
  await run("loadMessages()");
  assert.equal(retry.hidden, true);
  assert.match(status.textContent, /No messages yet/);
});
test("invalid post response preserves the draft and unlocks submission", async () => {
  const { elements, context, run, events } = setup();
  elements["message-name"] = { value: "tester" };
  elements["message-input"] = { value: "keep this draft" };
  const button = elements[".message-box button"] = {};
  context.fetch = async () => ({ ok: true, json: async () => ({}) });
  await run("addMessage()");
  assert.equal(elements["message-input"].value, "keep this draft");
  assert.equal(elements["message-name"].value, "tester");
  assert.equal(button.disabled, false);
  assert.ok(events.length);
});
test("older failed loads cannot overwrite a newer successful load", async () => {
  const { elements, context, run } = setup();
  elements["floating-wall"] = {};
  const status = elements["message-load-status"] = {};
  const retry = elements["message-retry"] = {};
  let rejectOld;
  context.fetch = () => new Promise((_, reject) => { rejectOld = reject; });
  const oldLoad = run("loadMessages()");
  context.fetch = async () => ({ ok: true, json: async () => ({ comments: [] }) });
  await run("loadMessages()");
  rejectOld(Error("old network failure"));
  await oldLoad;
  assert.match(status.textContent, /还没有留言/);
  assert.equal(retry.hidden, true);
});
test("auth blocks duplicate requests and mode changes until the request finishes", async () => {
  const elements = {
    "auth-email": { value: "test@example.com", focus() {} },
    "auth-password": { value: "test-password" },
    "auth-submit": {},
    "auth-error": {}
  };
  let requests = 0;
  let finish;
  const context = {
    SuperTokens: { init() {} }, EmailPassword: { init() {} }, Session: { init() {} },
    window: { APP_CONFIG: { apiDomain: "http://localhost:3001" }, location: { origin: "http://localhost:5500" }, addEventListener() {} },
    document: { getElementById: id => elements[id], querySelector() {}, addEventListener() {} },
    localStorage: { getItem: () => "zh" }, console,
    signIn: () => { requests++; return new Promise(resolve => { finish = resolve; }); }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("src/auth-src.js", "utf8").replace(/^import .*;\n/gm, ""), context);
  const run = code => vm.runInContext(code, context);
  const first = run("submitAuth()");
  await run("submitAuth()");
  run("switchAuthMode()");
  await run("openAuthModal()");
  assert.equal(requests, 1);
  assert.equal(run("authMode"), "signin");
  assert.equal(elements["auth-submit"].disabled, true);
  finish({ status: "WRONG_CREDENTIALS_ERROR" });
  await first;
  assert.equal(elements["auth-submit"].disabled, false);
  assert.match(elements["auth-error"].innerText, /邮箱或密码错误/);
  run("switchAuthMode()");
  assert.equal(run("authMode"), "signup");
  assert.equal(elements["auth-password"].autocomplete, "new-password");
});
test("a delayed wall refresh cannot bring back a deleted message", async () => {
  const { elements, context, run } = setup();
  elements["floating-wall"] = {};
  const rendered = [];
  context.capture = message => rendered.push(message.id);
  run("createFloatingMessage=capture");
  let finish;
  context.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = run("loadMessages()");
  context.window.removeWallMessage(1);
  finish({ ok: true, json: async () => ({ comments: [{ id: 1 }, { id: 2 }] }) });
  await pending;
  assert.deepEqual(rendered, [2]);
});

test("mobile backgrounds load numbered portrait files and never use desktop images", async () => {
  const paths = [];
  const query = { matches: true, addEventListener() {} };
  const { elements, run } = setup({
    window: { matchMedia: () => query, MOBILE_BACKGROUNDS: { folder: "images/hero-mobile/", extensions: ["png", "jpg"], maxImages: 3 } },
    Image: class {
      set src(path) {
        paths.push(path);
        this.naturalWidth = 1080;
        this.naturalHeight = 1920;
        queueMicrotask(() => /00[12]\.jpg$/.test(path) ? this.onload?.() : this.onerror?.());
      }
    }
  });
  const slide = elements["hero-slide"] = { removeAttribute(name) { delete this[name]; } };
  await run("discoverHeroImages()");
  assert.equal(slide.src, "images/hero-mobile/001.jpg");
  assert.equal(slide.hidden, false);
  run("changeHeroSlide()");
  assert.equal(slide.src, "images/hero-mobile/002.jpg");
  run("changeHeroSlide()");
  assert.equal(slide.src, "images/hero-mobile/001.jpg");
  assert.ok(paths.every(path => path.startsWith("images/hero-mobile/")));
  query.matches = false;
  await run("discoverHeroImages()");
  assert.equal(slide.src, "images/hero/001.png");
});

test("an empty mobile folder leaves the image hidden without falling back to desktop", async () => {
  const { elements, run } = setup({
    window: { matchMedia: () => ({ matches: true, addEventListener() {} }), MOBILE_BACKGROUNDS: { folder: "images/hero-mobile/", extensions: ["png"], maxImages: 99 } },
    Image: class { set src(path) { queueMicrotask(() => this.onerror()); } }
  });
  const slide = elements["hero-slide"] = { removeAttribute(name) { delete this[name]; } };
  await run("discoverHeroImages()");
  assert.equal(slide.hidden, true);
  assert.equal(slide.src, undefined);
  run("changeHeroSlide()");
  assert.equal(slide.src, undefined);
});
