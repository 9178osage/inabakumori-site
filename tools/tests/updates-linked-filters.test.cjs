const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Runs js/updates.js against a minimal DOM with a given ?query string.
function load(search, archiveDataset = {}, language = null, dates = []) {
  const element = (dataset = {}) => ({ dataset, hidden: false, textContent: "", attributes: {}, listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; this.hidden = false; },
    addEventListener(type, handler) { this.listeners[type] = handler; }, querySelector: () => null });
  const entries = [
    ["inabakumori", "youtube", "2026"], ["inabakumori", "youtube", "2025"],
    ["nknk", "pixiv", "2026"], ["nknk", "pixiv", "2025"], ["nknk", "campfire", "2026"]
  ].map(([creator, source, year]) => element({ creator, source, year }));
  const buttons = ["all", "inabakumori", "nknk"].map(filter => element({ filter }));
  const count = element(), empty = element(), langButton = element();
  let formatterCount = 0, timeWrites = 0;
  const times = dates.map(dateTime => {
    let value = "pre-rendered date";
    return { dateTime, get textContent() { return value; }, set textContent(text) { value = text; timeWrites++; } };
  });
  const metadata = Object.fromEntries(['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]'].map(selector => [selector, element()]));
  const document = {
    readyState: "complete", documentElement: { dataset: archiveDataset }, title: "",
    getElementById: id => ({ "updates-count": count, "updates-empty": empty, "updates-lang-btn": langButton })[id] || null,
    querySelector: selector => metadata[selector] || null,
    querySelectorAll: selector => selector.startsWith(".update-item") ? entries : selector === "[data-filter]" ? buttons : selector === "time[data-local-time]" ? times : []
  };
  const replaced = [], events = {};
  const window = {
    location: { search, pathname: "/updates.html", hash: "#feed-title" },
    history: { replaceState(state, title, url) { replaced.push(url); } }, siteStorage: { getItem: key => key === "language" ? language : null, setItem(key, value) { if (key === "language") language = value; } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(name, listener) { events[name] = listener; }, setInterval: () => 1, clearInterval() {}, localStorage: {}
  };
  const measuredIntl = { DateTimeFormat: class extends Intl.DateTimeFormat {
    constructor(...args) { super(...args); formatterCount++; }
  } };
  vm.runInContext(fs.readFileSync("js/updates.js", "utf8"), vm.createContext({ window, document, Intl: measuredIntl, Date }));
  return { entries, buttons, count, empty, replaced, document, metadata, langButton, window, events, times,
    formatterCount: () => formatterCount, timeWrites: () => timeWrites,
    shown: () => entries.filter(entry => !entry.hidden).map(entry => Object.values(entry.dataset).join("/")) };
}

test("updates page applies whitelisted creator, source and year from the homepage link", () => {
  const app = load("?creator=nknk&source=pixiv&year=2025");
  assert.deepEqual(app.shown(), ["nknk/pixiv/2025"]);
  assert.equal(app.buttons[2].attributes["aria-pressed"], "true");
  assert.match(app.count.textContent, /^pixiv · 2025 · 已收录 1 条/u);
});

test("unknown, malformed or injected filter values are ignored", () => {
  for (const search of ["?creator=<img%20src=x>&source=evil&year=1999", "?year=%E0%A4%A", "?source=__proto__&creator=constructor", "?creator=nknk=invalid", "?source=youtube=invalid", "?year=2025=invalid", "?source=youtube%3Dinvalid", ""]) {
    const app = load(search);
    assert.equal(app.shown().length, 5, search);
    assert.doesNotMatch(app.count.textContent, /img|evil|1999|proto/u, search);
  }
});

test("a malformed filter does not discard valid filters later in the query", () => {
  for (const search of ["?source=%E0%A4%A&creator=nknk&year=2025", "?creator=nknk&year=2025&source=%E0%A4%A"]) {
    assert.deepEqual(load(search).shown(), ["nknk/pixiv/2025"], search);
  }
});

test("a valid combination without work updates shows the empty state", () => {
  const app = load("?creator=nknk&source=youtube&year=2026");
  assert.deepEqual(app.shown(), []);
  assert.equal(app.empty.hidden, false);
  assert.match(app.count.textContent, /^YouTube · 2026 · 已收录 0 条/u);
});

test("choosing a creator on the updates page clears linked source and year", () => {
  const app = load("?source=youtube&year=2026");
  assert.deepEqual(app.shown(), ["inabakumori/youtube/2026"]);
  app.buttons[2].listeners.click();
  assert.equal(app.shown().length, 3);
});

test("choosing a creator keeps only ?creator in the URL (none for all) and drops source/year", () => {
  const app = load("?source=youtube&year=2026");
  app.buttons[1].listeners.click();
  assert.deepEqual(app.replaced, ["/updates.html?creator=inabakumori#feed-title"]);
  const all = load("?creator=nknk&source=pixiv");
  all.buttons[0].listeners.click();
  assert.deepEqual(all.replaced, ["/updates.html#feed-title"]);
  const plain = load("");
  plain.buttons[0].listeners.click();
  assert.deepEqual(plain.replaced, [], "no history write when the address already matches");
  const same = load("?creator=nknk");
  same.buttons[2].listeners.click();
  assert.deepEqual(same.replaced, [], "no history write when the address already matches");
});

test("a reload with the URL written by a creator click restores that creator", () => {
  const first = load("");
  first.buttons[2].listeners.click();
  const url = first.replaced.at(-1);
  const reloaded = load(url.slice(url.indexOf("?"), url.indexOf("#")));
  assert.deepEqual(reloaded.shown(), first.shown());
  assert.ok(reloaded.shown().length > 0 && reloaded.shown().every(item => item.startsWith("nknk/")));
});

test("only the first occurrence of a filter key counts, even when it is malformed", () => {
  assert.equal(load("?year=%E0%A4%A&year=2025").shown().length, 5);
  assert.equal(load("?year=1999&year=2025").shown().length, 5);
  assert.deepEqual(load("?year=2025&year=%E0%A4%A").shown(), ["inabakumori/youtube/2025", "nknk/pixiv/2025"]);
});

test("creator archives and page 2+ keep their slice in the localized title", () => {
  for (const [dataset, expected] of [
    [{}, "最新动态 · 稲葉曇与 NKNK"],
    [{ archiveCreator: "nknk", archivePage: "1" }, "NKNK 的 X 帖子 · 最新动态 · 稲葉曇与 NKNK"],
    [{ archiveCreator: "all", archivePage: "3" }, "第 3 页 · 最新动态 · 稲葉曇与 NKNK"],
    [{ archiveCreator: "inabakumori", archivePage: "12" }, "稲葉曇的 X 帖子 · 第 12 页 · 最新动态 · 稲葉曇与 NKNK"],
    [{ archiveCreator: "<script>", archivePage: "0x1" }, "最新动态 · 稲葉曇与 NKNK"]
  ]) assert.equal(load("", dataset).document.title, expected, JSON.stringify(dataset));
});

test("the client title mirrors the build-time title for every language", async () => {
  const { xPostsPageTitle } = await import("../render-x-posts.mjs");
  for (const language of ["zh", "en", "ja"]) for (const [creator, page] of [["all", 1], ["all", 2], ["nknk", 1], ["inabakumori", 7]]) {
    const app = load("", { archiveCreator: creator, archivePage: String(page) }, language);
    assert.equal(app.document.title, xPostsPageTitle(creator, page).title[language], `${language} ${creator} ${page}`);
  }
});

test("language changes keep Open Graph metadata aligned with the current archive title and description", () => {
  for (const dataset of [{}, { archiveCreator: "nknk", archivePage: "3" }]) {
    const app = load("", dataset, "zh");
    const check = language => {
      assert.equal(app.document.documentElement.lang, { zh: "zh-CN", en: "en", ja: "ja" }[language]);
      assert.equal(app.metadata['meta[property="og:title"]'].attributes.content, app.document.title);
      assert.equal(app.metadata['meta[property="og:description"]'].attributes.content, app.metadata['meta[name="description"]'].content);
      assert.ok(app.metadata['meta[name="description"]'].content.length > 0);
    };
    check("zh");
    const originalDescription = app.metadata['meta[property="og:description"]'].attributes.content;
    for (const language of ["en", "ja", "zh"]) {
      app.langButton.listeners.click();
      check(language);
      if (language !== "zh") assert.notEqual(app.metadata['meta[property="og:description"]'].attributes.content, originalDescription);
    }
    app.window.siteStorage.setItem("language", "en");
    app.events.storage({ key: "language", storageArea: app.window.localStorage });
    check("en");
    app.window.siteStorage.setItem("language", "ja");
    app.events.pageshow();
    check("ja");
  }
});

test("localized dates reuse one formatter per language, retain JST midnight and skip unchanged writes", () => {
  const dates = ["2026-10-23T14:59:00Z", "2026-10-23T15:00:00Z", "not-a-date"];
  const app = load("", {}, "zh", dates);
  const check = language => {
    const formatter = new Intl.DateTimeFormat({ zh: "zh-CN", en: "en-US", ja: "ja-JP" }[language], {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo"
    });
    for (let index = 0; index < 2; index++) assert.equal(app.times[index].textContent, formatter.format(new Date(dates[index])) + " JST");
    assert.equal(app.times[2].textContent, "pre-rendered date", "invalid dates retain their existing text");
    assert.notEqual(app.times[0].textContent, app.times[1].textContent, "JST midnight crosses the calendar day");
  };
  check("zh");
  assert.equal(app.formatterCount(), 1);
  assert.equal(app.timeWrites(), 2);
  app.events.pageshow();
  app.events.pageshow();
  assert.equal(app.formatterCount(), 1, "same-language page resumes reuse the formatter");
  assert.equal(app.timeWrites(), 2, "same-language page resumes do not rewrite dates");
  for (const [index, language] of ["en", "ja", "zh"].entries()) {
    app.langButton.listeners.click();
    check(language);
    assert.equal(app.formatterCount(), Math.min(index + 2, 3));
    assert.equal(app.timeWrites(), (index + 2) * 2);
  }
  app.events.pageshow();
  assert.equal(app.formatterCount(), 3);
  assert.equal(app.timeWrites(), 8);
});

test("pages without valid localized times never construct a date formatter", () => {
  for (const dates of [[], ["invalid", ""]]) {
    const app = load("", {}, "zh", dates);
    app.events.pageshow();
    app.langButton.listeners.click();
    assert.equal(app.formatterCount(), 0);
    assert.equal(app.timeWrites(), 0);
  }
});
