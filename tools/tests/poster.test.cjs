const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const directory = path.join(root, "网站海报");
const source = fs.readFileSync(path.join(directory, "poster.js"), "utf8");

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = { toggle: (name, enabled) => { this[name] = enabled; } };
  }
  set innerHTML(_) { throw new Error("HTML injection sink used"); }
  set textContent(text) { this.children = [String(text)]; }
  get textContent() { return this.children.map(child => typeof child === "string" ? child : child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
}

function render(search, script = source) {
  const nodes = new Map();
  const langs = ["zh", "en", "ja"].map(lang => {
    const node = new Element("span");
    node.dataset.l = lang;
    return node;
  });
  const document = {
    documentElement: {},
    createElement: tag => new Element(tag),
    createTextNode: text => String(text),
    getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, new Element("div"));
      return nodes.get(id);
    },
    querySelectorAll: selector => selector === "#langs span" ? langs : []
  };
  vm.runInNewContext(script, { document, location: { search }, URLSearchParams });
  return { nodes, document, langs };
}

test("poster renders all languages and defaults unsupported or prototype names to Chinese", () => {
  for (const [query, lang, heading] of [
    ["", "zh-CN", "气象观测站"], ["?lang=zh", "zh-CN", "气象观测站"],
    ["?lang=en", "en", "WEATHEROBSERVATIONSTATION"], ["?lang=ja", "ja", "気象観測所"],
    ["?lang=fr", "zh-CN", "气象观测站"], ["?lang=zh-CN", "zh-CN", "气象观测站"],
    ["?lang=constructor", "zh-CN", "气象观测站"], ["?lang=__proto__", "zh-CN", "气象观测站"],
    ["?lang=%3Cscript%3E", "zh-CN", "气象观测站"]
  ]) {
    const { nodes, document, langs } = render(query);
    assert.equal(document.documentElement.lang, lang, query);
    assert.equal(nodes.get("title").textContent, heading, query);
    assert.equal(nodes.get("reads").children.length, 3);
    assert.equal(nodes.get("menu").children.length, 6);
    assert.equal(nodes.get("menu").children[5].children[1].children[0].tagName, "em");
    assert.equal(nodes.get("intro").children[1].tagName, "br");
    assert.equal(langs.filter(node => node.on).length, 1);
    assert.equal(nodes.get("rain").children.length, 96);
  }
});

test("poster copy stays text even when it contains markup characters", () => {
  const marker = '<img src=x onerror="alert(1)">&';
  const { nodes } = render("", source.replace('title: ["气象观测站"]', `title: [${JSON.stringify(marker)}]`));
  const heading = nodes.get("title").children[0];
  assert.equal(heading.textContent, marker);
  assert.equal(heading.dataset.t, marker);
  assert.equal(heading.children.length, 1);
});

test("all three poster versions display the main site's song, gallery and post counts", () => {
  const arrayLength = (file, name) => vm.runInNewContext(`${fs.readFileSync(path.join(root, file), "utf8")}\n${name}.length`);
  const posts = JSON.parse(fs.readFileSync(path.join(root, "data/x-posts/manifest.json"), "utf8"));
  const expected = [arrayLength("js/songs.js", "SONGS"), arrayLength("js/nknk-gallery.js", "NKNK_GALLERY"), posts.count]
    .map(count => count.toLocaleString("en-US"));
  for (const lang of ["zh", "en", "ja"]) {
    const { nodes } = render(`?lang=${lang}`);
    const readings = nodes.get("reads").children.map(row => row.children[0].textContent);
    assert.deepEqual(readings, expected, `${lang}: update READINGS in 网站海报/poster.js when source totals change`);
  }
});

test("offline poster has strict CSP, portable assets and remains outside public routes", async () => {
  const html = fs.readFileSync(path.join(directory, "poster.html"), "utf8");
  const css = fs.readFileSync(path.join(directory, "poster.css"), "utf8");
  assert.match(html, /http-equiv="Content-Security-Policy"/u);
  for (const directive of ["script-src", "style-src", "img-src"]) assert.ok(html.includes(`${directive} 'self' file:`), `${directive}: offline assets do not depend on file origin handling`);
  assert.match(html, /require-trusted-types-for 'script'; trusted-types 'none'/u);
  assert.doesNotMatch(html, /unsafe-inline|<style\b|<script>|\bstyle=/u);
  assert.doesNotMatch(css, /@font-face|file:\/\//u);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/gu)) {
    assert.ok(fs.statSync(path.join(directory, match[1])).isFile(), match[1]);
  }
  const { publicPath } = await import("../static-server.mjs");
  assert.equal(publicPath("/网站海报/poster.html"), null);
});
