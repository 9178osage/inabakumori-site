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
  const context = {
    console, URL, setInterval() {},
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
  run(fs.readFileSync("i18n.js", "utf8"));
  run(fs.readFileSync("songs.js", "utf8"));
  if (extraSong) run(`SONGS.push(${JSON.stringify(extraSong)})`);
  run(fs.readFileSync("script.js", "utf8"));
  run("initTagFilter()");
  return { run, elements, list, opened };
}

test("the original 37 songs retain their exact order, titles, URLs, albums, and singers", () => {
  const { run, list, elements } = setup();
  const songs = JSON.parse(run("JSON.stringify(SONGS)"));
  assert.equal(songs.length, 47);
  const digest = createHash("sha256")
    .update(JSON.stringify(songs.slice(0, 37).map(song => [song.title, song.youtube, song.album, song.singers])))
    .digest("hex");
  assert.equal(digest, "1d559b3903dbfda7d33748235ebb213c13453c9985fc4563b6d3cd4fe44256f6");
  assert.equal(list.children.length, songs.length);
  assert.equal(elements["tag-result-count"].textContent, "显示 47 / 47 首");
  songs.forEach((song, index) => {
    const row = list.children[index];
    assert.equal(row.querySelector(".song-title-text").textContent, `${String(index + 1).padStart(2, "0")}　${song.title}`);
    assert.equal(row.href, song.youtube);
    assert.deepEqual(row.querySelectorAll(".song-inline-tag").map(tag => tag.dataset.rawTag), [song.album, ...song.singers]);
    assert.equal(row.querySelector("img").src, `https://i.ytimg.com/vi/${new URL(song.youtube).pathname.slice(1)}/mqdefault.jpg`);
  });
});

test("an additional data-only song renders and participates in search, singer counts, and random play", () => {
  const extra = {
    title: "New <song> & test",
    youtube: "https://www.youtube.com/watch?v=abcdefghijk",
    album: "NEW ALBUM",
    singers: ["星界", "Test Singer"]
  };
  const { run, list, elements, opened } = setup(extra);
  const row = list.children.at(-1);
  assert.equal(list.children.length, 48);
  assert.equal(row.querySelector(".song-title-text").textContent, "48　New <song> & test");
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
    input.dispatch("input");
    assert.deepEqual(list.children.filter(song => !song.hidden), [row], query);
    assert.equal(elements["tag-result-count"].textContent, "显示 1 / 48 首");
  }
  input.value = "sekai";
  input.dispatch("input");
  assert.deepEqual(list.children.filter(song => !song.hidden), [list.children[25], row]);
  input.value = "New <song>, +miku";
  input.dispatch("input");
  assert.ok(list.children.every(song => song.hidden));
  assert.equal(elements["tag-empty-state"].hidden, false);
  elements["tag-filter-clear"].dispatch("click");
  assert.equal(input.value, "");
  assert.equal(elements["tag-result-count"].textContent, "显示 48 / 48 首");
  run("Math.random = () => 0.999999; playRandomSong()");
  assert.deepEqual(opened, [[extra.youtube, "_blank", "noopener,noreferrer"]]);
});

test("Japanese singer tags filter correctly and counts use Japanese", () => {
  const { run, list, elements } = setup();
  run('currentLanguage = "ja"; updateTagLanguage()');
  assert.equal(run('getTagDisplayLabel("初音未来")'), "初音ミク");
  assert.equal(run('getTagInputLabel("歌爱雪")'), "歌愛ユキ");
  elements["tag-filter-input"].value = "歌愛ユキ";
  elements["tag-filter-input"].dispatch("input");
  assert.ok(list.children.filter(row => !row.hidden).length > 0);
  assert.match(elements["tag-result-count"].textContent, /47 曲中/);
  assert.match(list.children[0].querySelector(".song-views").dataset.ja, /回視聴/);
});
