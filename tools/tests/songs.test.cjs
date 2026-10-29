const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createHash } = require("node:crypto");

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.value = "";
    this.className = "";
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      toggle: (name, active) => {
        this.className = this.className.split(/\s+/).filter(value => value && value !== name).join(" ");
        if (active) this.classList.add(name);
      }
    };
  }
  set textContent(value) { this.children = []; this.text = String(value); }
  get textContent() { return (this.text || "") + this.children.map(child => child.textContent).join(""); }
  set innerHTML(value) {
    assert.equal(value, "", "The renderer should create elements, not interpolate HTML");
    this.replaceChildren();
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  replaceChildren() { this.children = []; this.text = ""; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  dispatch(name) { for (const handler of this.listeners[name] || []) handler({ target: this }); }
  focus() {}
  querySelectorAll(selector) {
    const match = selector.match(/^(\w+)?(?:\.([\w-]+))?(?:\[([\w-]+)\])?$/);
    assert.ok(match, `Unsupported test selector: ${selector}`);
    const [, tag, className, attribute] = match;
    const matches = element => (!tag || element.tagName === tag)
      && (!className || element.classList.contains(className))
      && (!attribute || (attribute.startsWith("data-")
        ? attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) in element.dataset
        : attribute in element));
    return this.children.flatMap(child => [ ...(matches(child) ? [child] : []), ...child.querySelectorAll(selector) ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function setup(extraSong) {
  const elements = Object.fromEntries([
    "song-list", "tag-filter-input", "tag-filter-clear", "tag-suggestions",
    "tag-empty-state", "tag-result-count", ".song-library"
  ].map(id => [id, new Element()]));
  const opened = [];
  const list = elements["song-list"];
  // Manual timers: the tag filter is debounced, so tests flush pending callbacks explicitly.
  const timers = new Map();
  let nextTimer = 1;
  const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  const context = {
    console, URL, setInterval() {},
    setTimeout: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: id => { timers.delete(id); },
    localStorage: { getItem: () => null },
    document: {
      addEventListener() {},
      getElementById: id => elements[id],
      querySelector: selector => elements[selector],
      querySelectorAll: selector => {
        if (selector === ".song-scroll a") return list.querySelectorAll("a");
        if (selector === "#song-list a[href]") return list.querySelectorAll("a[href]");
        if (selector === ".song-inline-tag[data-raw-tag]") return list.querySelectorAll(selector);
        return [];
      },
      createElement: tag => new Element(tag)
    },
    window: {
      APP_CONFIG: { apiDomain: "http://localhost:3001" },
      addEventListener() {},
      open: (...args) => opened.push(args)
    }
  };
  vm.createContext(context);
  const run = code => vm.runInContext(code, context);
  run(fs.readFileSync("js/i18n.js", "utf8"));
  run(fs.readFileSync("js/songs.js", "utf8"));
  if (extraSong) run(`SONGS.push(${JSON.stringify(extraSong)})`);
  run(fs.readFileSync("script.js", "utf8"));
  run("initTagFilter()");
  return { run, elements, list, opened, flush, timers };
}

test("all songs retain their exact order, titles, URLs, albums, and singers", () => {
  const { run, list, elements, flush } = setup();
  const songs = JSON.parse(run("JSON.stringify(SONGS)"));
  assert.equal(songs.length, 52);
  const digest = createHash("sha256")
    .update(JSON.stringify(songs.map(song => [song.title, song.youtube, song.album, song.singers])))
    .digest("hex");
  // Covers every song; includes the officially verified Anticyclone / Non-Use singer corrections.
  assert.equal(digest, "7b6388123232c9d2186a95d103064e8d719e14e879fe823719a5e578ef9ef4cb");
  for (const song of songs) {
    const url = new URL(song.youtube);
    assert.deepEqual([...url.searchParams.keys()].filter(key => key !== "v"), [], `${song.title}: no tracking parameters`);
  }
  assert.equal(list.children.length, songs.length);
  assert.equal(elements["tag-result-count"].textContent, "显示 52 / 52 首");
  songs.forEach((song, index) => {
    const row = list.children[index];
    assert.equal(row.querySelector(".song-title-text").textContent, `${String(index + 1).padStart(2, "0")}　${song.title}`);
    assert.equal(row.href, song.youtube);
    assert.deepEqual(row.querySelectorAll(".song-inline-tag").map(tag => tag.dataset.rawTag), [song.album, ...song.singers]);
    assert.equal(row.querySelector("img").src, `https://i.ytimg.com/vi/${new URL(song.youtube).pathname.slice(1)}/mqdefault.jpg`);
  });
});

test("verified Anticyclone and Non-Use vocals agree with homepage Miku filtering", () => {
  const { run, list, elements, flush } = setup();
  const songs = JSON.parse(run("JSON.stringify(SONGS)"));
  const archive = JSON.parse(fs.readFileSync("data/song-archive.json", "utf8")).songs;
  const singerNames = { "歌愛ユキ": "歌爱雪", "初音ミク": "初音未来" };
  for (const id of ["2_93SNGYgYs", "-5T-L0b43no"]) {
    const song = songs.find(entry => entry.youtube.endsWith(id));
    assert.deepEqual(song.singers, archive[id].vocal.split(" & ").map(name => singerNames[name]), song.title);
  }
  elements["tag-filter-input"].value = "初音ミク";
  elements["tag-filter-input"].dispatch("input"); flush();
  assert.equal(list.children.find(row => row.href.endsWith("2_93SNGYgYs")).hidden, true, "Anticyclone is sung only by Yuki");
  assert.equal(list.children.find(row => row.href.endsWith("-5T-L0b43no")).hidden, false, "Non-Use includes Miku");
});

test("an additional data-only song renders and participates in search, singer counts, and random play", () => {
  const extra = {
    title: "New <song> & test",
    youtube: "https://www.youtube.com/watch?v=abcdefghijk",
    album: "NEW ALBUM",
    singers: ["星界", "Test Singer"]
  };
  const { run, list, elements, opened, flush } = setup(extra);
  const row = list.children.at(-1);
  assert.equal(list.children.length, 53);
  assert.equal(row.querySelector(".song-title-text").textContent, "53　New <song> & test");
  assert.equal(row.dataset.songTitle, extra.title);
  assert.equal(row.href, extra.youtube);
  assert.equal(row.target, "_blank");
  assert.equal(row.rel, "noopener noreferrer");
  assert.equal(row.querySelector("img").src, "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
  assert.deepEqual(row.querySelectorAll(".song-inline-tag").map(tag => tag.textContent), ["NEW ALBUM", "星界 / SEKAI", "Test Singer"]);
  const suggestions = elements["tag-suggestions"].children.map(chip => chip.dataset.tag);
  assert.ok(suggestions.includes("new album"));
  assert.ok(suggestions.includes("星界"), "A singer appearing in two songs becomes a suggested tag");
  assert.ok(!suggestions.includes("test singer"), "A one-song singer stays under Other");
  assert.ok(!list.children[25]._songTags.includes("其他"), "SEKAI's original song no longer counts as a one-song singer");

  const input = elements["tag-filter-input"];
  for (const query of [extra.title, "Test Singer", "NEW ALBUM", "New <song>, +sekai"]) {
    input.value = query;
    input.dispatch("input"); flush();
    assert.deepEqual(list.children.filter(song => !song.hidden), [row], query);
    assert.equal(elements["tag-result-count"].textContent, "显示 1 / 53 首");
  }
  input.value = "sekai";
  input.dispatch("input"); flush();
  assert.deepEqual(list.children.filter(song => !song.hidden), [list.children[25], row]);
  input.value = "New <song>, +miku";
  input.dispatch("input"); flush();
  assert.ok(list.children.every(song => song.hidden));
  assert.equal(elements["tag-empty-state"].hidden, false);
  elements["tag-filter-clear"].dispatch("click");
  assert.equal(input.value, "");
  assert.equal(elements["tag-result-count"].textContent, "显示 53 / 53 首");
  run("Math.random = () => 0.999999; playRandomSong()");
  assert.deepEqual(opened, [[extra.youtube, "_blank", "noopener,noreferrer"]]);
});

test("random play respects filtering, opens nothing for no matches, and recovers after clearing", () => {
  const { run, list, elements, opened, flush } = setup();
  const input = elements["tag-filter-input"];
  input.value = "+ANTICYCLONE";
  input.dispatch("input"); flush();
  const visible = list.children.filter(song => !song.hidden);
  assert.ok(visible.length > 1 && visible.length < list.children.length);
  run("Math.random = () => 0; playRandomSong()");
  run("Math.random = () => 0.999999; playRandomSong()");
  assert.deepEqual(opened, [visible[0], visible.at(-1)].map(song => [song.href, "_blank", "noopener,noreferrer"]));

  input.value = "+no-such-song-123456";
  input.dispatch("input"); flush();
  assert.ok(list.children.every(song => song.hidden));
  run("playRandomSong()");
  assert.equal(opened.length, 2);

  elements["tag-filter-clear"].dispatch("click");
  run("playRandomSong()");
  assert.equal(opened.at(-1)[0], list.children.at(-1).href);
});

test("Japanese singer tags filter correctly and counts use Japanese", () => {
  const { run, list, elements, flush } = setup();
  run('currentLanguage = "ja"; updateTagLanguage()');
  assert.equal(run('getTagDisplayLabel("初音未来")'), "初音ミク");
  assert.equal(run('getTagInputLabel("歌爱雪")'), "歌愛ユキ");
  elements["tag-filter-input"].value = "歌愛ユキ";
  elements["tag-filter-input"].dispatch("input"); flush();
  assert.ok(list.children.filter(row => !row.hidden).length > 0);
  assert.match(elements["tag-result-count"].textContent, /52 曲中/);
  assert.match(list.children[0].querySelector(".song-views").dataset.ja, /回再生/);
});

test("typing in the tag filter is debounced; the clear button filters immediately", () => {
  const { run, list, elements, flush, timers } = setup();
  const input = elements["tag-filter-input"];
  assert.equal(run("TAG_FILTER_DEBOUNCE_MS"), 150);
  input.value = "+no-such-song-123456";
  input.dispatch("input");
  input.dispatch("input");
  assert.equal(timers.size, 1, "repeated keystrokes keep a single pending run");
  assert.ok(list.children.some(song => !song.hidden), "nothing is filtered before the debounce fires");
  flush();
  assert.ok(list.children.every(song => song.hidden));
  input.value = "x";
  input.dispatch("input");
  elements["tag-filter-clear"].dispatch("click");
  assert.equal(timers.size, 0, "a direct update cancels the pending debounced run");
  assert.ok(list.children.every(song => !song.hidden));
});
