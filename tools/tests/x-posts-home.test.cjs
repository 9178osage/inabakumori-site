const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup(creators = [...Array(6).fill("inabakumori"), ...Array(6).fill("nknk")], totals = { xTotal: "1852", xTotalInabakumori: "1120", xTotalNknk: "732" }, { legacyObject = false } = {}) {
  const events = new Map();
  const element = (dataset = {}) => ({
    dataset, hidden: true, textContent: "", attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    set innerHTML(value) { throw new Error(`innerHTML must not be used: ${value}`); }
  });
  const posts = creators.map(creator => ({ ...element({ creator }), hidden: false }));
  const buttons = ["all", "inabakumori", "nknk"].map(xHomeCreator => element({ xHomeCreator }));
  const filters = element();
  const count = element();
  const archiveLink = element();
  const empty = element();
  archiveLink.textContent = "在本站浏览已收录的全部帖子 →";
  const section = {
    dataset: totals,
    querySelector: selector => ({ ".x-home-filters": filters, "[data-x-home-count]": count, "[data-x-archive-link]": archiveLink, "[data-x-home-empty]": empty })[selector] ?? null,
    querySelectorAll: selector => selector === ".x-post[data-creator]" ? posts : selector === "[data-x-home-creator]" ? buttons : []
  };
  const document = { readyState: "complete", querySelector: selector => selector === "[data-x-posts-home]" ? section : null };
  const context = vm.createContext({ document, currentLanguage: "zh", Number, Object: legacyObject ? { prototype: Object.prototype } : Object, String, window: { addEventListener(type, handler) { events.set(type, handler); } } });
  vm.runInContext(fs.readFileSync("js/x-posts-home.js", "utf8"), context);
  return { context, posts, buttons, filters, count, archiveLink, empty, events, visible: () => posts.filter(post => !post.hidden) };
}

test("homepage X filters appear only after the script runs and show at most three recent posts", () => {
  const app = setup();
  assert.equal(app.filters.hidden, false);
  assert.equal(app.visible().length, 3);
  assert.equal(app.count.hidden, false);
  assert.equal(app.count.textContent, "显示最近 3 条 · 已收录 1852 条");
  assert.equal(app.buttons[0].attributes["aria-pressed"], "true");
  assert.equal(app.archiveLink.attributes.href, "updates.html");
});

test("choosing a creator shows only their posts and points the archive link at their pages", () => {
  const app = setup();
  app.buttons[2].listeners.click();
  assert.ok(app.visible().length === 3 && app.visible().every(post => post.dataset.creator === "nknk"));
  assert.equal(app.buttons[2].attributes["aria-pressed"], "true");
  assert.equal(app.buttons[0].attributes["aria-pressed"], "false");
  assert.equal(app.count.textContent, "显示最近 3 条 · 已收录 732 条");
  assert.equal(app.archiveLink.attributes.href, "updates-nknk.html");
  assert.equal(app.archiveLink.textContent, "在本站浏览 NKNK 的全部帖子 →");
  app.buttons[1].listeners.click();
  assert.ok(app.visible().every(post => post.dataset.creator === "inabakumori"));
  assert.equal(app.archiveLink.attributes.href, "updates-inabakumori.html");
});

test("language changes keep the selected creator and relabel the count and archive link", () => {
  const app = setup();
  app.buttons[1].listeners.click();
  app.context.currentLanguage = "ja";
  app.events.get("languagechange")();
  assert.equal(app.count.textContent, "最新3件を表示 · 収録1120件");
  assert.equal(app.archiveLink.textContent, "稲葉曇の投稿をすべて見る →");
  app.context.currentLanguage = "en";
  app.events.get("languagechange")();
  assert.equal(app.count.textContent, "Showing the latest 3 · 1120 collected");
  assert.ok(app.visible().every(post => post.dataset.creator === "inabakumori"));
});

test("unknown filter values and malformed totals are ignored safely", () => {
  const app = setup(undefined, { xTotal: "nope" });
  assert.equal(app.count.textContent, "显示最近 3 条 · 已收录 0 条");
  app.buttons[0].dataset.xHomeCreator = "__proto__";
  app.buttons[0].listeners.click();
  assert.equal(app.visible().length, 3);
  assert.equal(app.archiveLink.attributes.href, "updates.html");
});

test("a browser without Object.hasOwn can still switch the X post filter", () => {
  const app = setup(undefined, undefined, { legacyObject: true });
  assert.doesNotThrow(() => app.buttons[1].listeners.click());
  assert.equal(app.visible().length, 3);
  assert.ok(app.visible().every(post => post.dataset.creator === "inabakumori"));
  assert.equal(app.archiveLink.attributes.href, "updates-inabakumori.html");
});

test("the homepage loads the filter as an external script and keeps its controls hidden without JavaScript", async () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /<script src="js\/x-posts-home\.js" defer><\/script>/u);
  assert.match(html, /<!-- X-POSTS:HOME -->/u);
  const source = fs.readFileSync("js/x-posts-home.js", "utf8");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/u);
  const { renderXPostsHome } = await import("../render-x-posts.mjs");
  const rendered = renderXPostsHome({ version: 1, coverage: [], items: [] });
  assert.match(rendered, /class="x-home-filters"[^>]*hidden>/u);
  assert.match(rendered, /data-x-home-count role="status" aria-live="polite" hidden>/u);
  assert.match(rendered, /data-x-archive-link href="updates\.html"/u);
});

test("a creator with no collected posts shows the empty note instead of a blank list", () => {
  const app = setup(Array(6).fill("inabakumori"), { xTotal: "6", xTotalInabakumori: "6", xTotalNknk: "0" });
  assert.equal(app.empty.hidden, true);
  app.buttons[2].listeners.click();
  assert.equal(app.visible().length, 0);
  assert.equal(app.empty.hidden, false);
  app.buttons[1].listeners.click();
  assert.equal(app.empty.hidden, true);
});
