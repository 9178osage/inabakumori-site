const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const source = fs.readFileSync("script.js", "utf8");
function setup() {
  const elements = {};
  const messages = [];
  const events = [];
  const context = {
    console: { log() {
    }, error() {
    } },
    localStorage: { getItem: () => null, setItem() {
    } },
    document: {
      documentElement: {},
      addEventListener() {
      },
      getElementById: (id) => elements[id],
      querySelector: (selector) => elements[selector],
      querySelectorAll: (selector) => selector.startsWith(".floating-message") ? messages : []
    },
    window: {
      APP_CONFIG: { apiDomain: "http://localhost:3001" },
      addEventListener() {
      },
      dispatchEvent: (e) => events.push(e.type)
    },
    setInterval() {
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    alert: (text) => events.push(text)
  };
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
  resolve({ ok: true, json: async () => ({ comment: {} }) });
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
  const wall = elements["floating-wall"] = {
    clientWidth: 900,
    clientHeight: 650,
    appendChild(element) {
      element.isConnected = true;
      messages.push(element);
    }
  };
  context.document.createElement = () => ({
    dataset: {},
    style: {},
    offsetWidth: 150,
    offsetHeight: 40,
    isConnected: false,
    animate(_, options) {
      return { currentTime: 0, effect: { getTiming: () => options }, cancel() {
      } };
    },
    remove() {
      this.isConnected = false;
      messages.splice(messages.indexOf(this), 1);
    }
  });
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
  for (const [hostname, protocol, expected] of [
    ["localhost", "http:", "http://localhost:3001"],
    ["127.0.0.1", "http:", "http://127.0.0.1:3001"],
    ["fans.example", "https:", "https://fans.example"]
  ]) {
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
test('unified search matches titles and tags with required keywords', () => {
  const { elements, context, run } = setup();
  const songs = [
    { dataset: { songTitle: 'ラグトレイン' }, _songTags: ['歌爱雪'], textContent: '18　ラグトレイン' },
    { dataset: { songTitle: 'ハルノ寂寞' }, _songTags: ['弦卷真纪'], textContent: '19　ハルノ寂寞' }
  ];
  const tags = elements['tag-filter-input'] = { value: 'ラグ' };
  elements['.song-library'] = { classList: { toggle() {} } };
  const empty = elements['tag-empty-state'] = {};
  const count = elements['tag-result-count'] = {};
  context.document.querySelectorAll = selector => selector === '.song-scroll a' ? songs : [];
  run('updateTagFilter()');
  assert.deepEqual(songs.map(song => song.hidden), [false, true]);
  assert.equal(count.textContent, '显示 1 / 2 首');
  tags.value = 'ラグ, +maki';
  run('updateTagFilter()');
  assert.ok(songs.every(song => song.hidden));
  assert.equal(empty.hidden, false);
  tags.value = 'maki';
  run('updateTagFilter()');
  assert.deepEqual(songs.map(song => song.hidden), [true, false]);
  tags.value = '';
  run('updateTagFilter()');
  assert.ok(songs.every(song => !song.hidden));
  assert.equal(songs[0].textContent, '18　ラグトレイン');
  assert.equal(run('songMatchesTitle("ラグトレイン", "  ﾗｸﾞ  ")'), true);
  assert.equal(run('songMatchesTitle("Song (album ver.)", "ALBUM")'), true);
});
