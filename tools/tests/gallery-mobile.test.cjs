const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Small event-capable DOM fixture: run the actual gallery initializer and its event handlers.
// Image src assignment is observable, so hidden duplicate thumbnails cannot pass these checks.
function galleryFixture({ assetPilot, compact = true } = {}) {
  let document;
  class Element {
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.style = {};
      this.attributes = {}; this.listeners = {}; this.className = ""; this.hidden = false;
      this.offsetWidth = 100; this.offsetLeft = 0; this.clientWidth = 330; this.scrollWidth = 24000;
      this.classList = {
        contains: name => this.className.split(" ").includes(name),
        toggle: (name, on) => { const all = new Set(this.className.split(" ").filter(Boolean)); if (on) all.add(name); else all.delete(name); this.className = [...all].join(" "); },
        add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false)
      };
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, options = {}) {
      const event = { type, target: this, preventDefault() {}, ...options };
      for (let node = this; node; node = node.parentNode) for (const fn of node.listeners[type] || []) fn(event);
    }
    appendChild(child) {
      if (child.tagName === "FRAGMENT") { for (const item of [...child.children]) this.appendChild(item); return child; }
      child.remove(); child.parentNode = this; this.children.push(child); return child;
    }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); children.forEach(child => this.appendChild(child)); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) {
      if (name.startsWith("data-")) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] ?? null;
      return this.attributes[name] ?? this[name] ?? null;
    }
    removeAttribute(name) { delete this.attributes[name]; if (name.startsWith("data-")) delete this.dataset[name.slice(5)]; else delete this[name]; }
    matches(selector) {
      return selector.split(",").some(part => {
        let rule = part.trim();
        const excluded = [...rule.matchAll(/:not\(([^)]+)\)/g)];
        if (excluded.some(match => this.matches(match[1]))) return false;
        rule = rule.replace(/:not\([^)]+\)/g, "");
        const tag = /^[a-z]+/i.exec(rule)?.[0];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        if ([...rule.matchAll(/\.([\w-]+)/g)].some(match => !this.classList.contains(match[1]))) return false;
        return [...rule.matchAll(/\[([\w-]+)(?:=['"]([^'"]*)['"])?\]/g)].every(([, name, value]) => value === undefined ? this.getAttribute(name) !== null : this.getAttribute(name) === value);
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(child) { return child === this || this.children.some(node => node.contains(child)); }
    focus() { document.activeElement = this; this.dispatch("focusin"); }
    getBoundingClientRect() { return { left: 0, right: 100, width: 100 }; }
  }
  const ids = Object.fromEntries(["artwork", "nknk-gallery", "nknk-lightbox", "nknk-lightbox-image", "nknk-lightbox-caption", "nknk-lightbox-close", "nknk-lightbox-prev", "nknk-lightbox-next"].map(id => [id, new Element()]));
  const body = new Element("body"); body.appendChild(ids.artwork); ids.artwork.appendChild(ids["nknk-gallery"]); body.appendChild(ids["nknk-lightbox"]);
  for (const id of ["image", "caption", "close", "prev", "next"]) ids["nknk-lightbox"].appendChild(ids[`nknk-lightbox-${id}`]);
  ids["nknk-lightbox"].hidden = true;
  const docEvents = {}, windowEvents = {}, scheduled = [];
  document = { body, activeElement: body, hidden: false, getElementById: id => ids[id], createElement: tag => new Element(tag), createDocumentFragment: () => new Element("fragment"), addEventListener: (type, fn) => { docEvents[type] = fn; } };
  const media = new Map();
  const window = { APP_CONFIG: { assetPilot }, scrollY: 0, scrollTo() {}, addEventListener: (type, fn) => { windowEvents[type] = fn; }, matchMedia: query => {
    if (!media.has(query)) media.set(query, { matches: compact && query.includes("max-width"), addEventListener(type, fn) { this.changed = fn; } });
    return media.get(query);
  } };
  let intervals = 0;
  const history = { state: {}, scrollRestoration: "auto", pushState(state) { this.state = state; }, back() { this.state = {}; windowEvents.popstate(); } };
  const context = { window, document, history, URL, location: { href: "https://example.test/#artwork" }, currentLanguage: "zh", performance: { now: () => 1000 }, Image: Element,
    setTimeout: fn => { scheduled.push(fn); }, clearTimeout() {}, setInterval: () => { intervals++; return intervals; }, clearInterval() {}, queueMicrotask: fn => fn(), requestAnimationFrame: fn => fn(), getComputedStyle: () => ({ gap: "12px" }) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/nknk-gallery.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("js/nknk-gallery-ui.js", "utf8"), context);
  const flushTasks = () => { while (scheduled.length) scheduled.shift()(); };
  docEvents.DOMContentLoaded(); flushTasks();
  return { ids, document, window, context, media, docEvents, history, flushTasks, root: ids["nknk-gallery"], intervalCount: () => intervals };
}

function pilotConfig() {
  const origin = "https://station-assets.pages.dev";
  return { enabled: true, origin, thumbnails: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
    `images/optimized/nknk/mobile/${index + 1}.webp`, `${origin}/assets/${index + 1}-0123456789ab.webp`
  ])) };
}

test("asset pilot is inactive without an enabled config and never alters desktop thumbnails", () => {
  for (const assetPilot of [undefined, { ...pilotConfig(), enabled: false }]) {
    const app = galleryFixture({ assetPilot });
    assert.equal(app.root.querySelectorAll("img")[0].src, "images/optimized/nknk/1.webp");
  }
  const desktop = galleryFixture({ assetPilot: pilotConfig(), compact: false });
  assert.equal(desktop.root.querySelectorAll("img")[0].src, "images/optimized/nknk/1.webp");
  assert.ok(desktop.root.querySelectorAll("img").every(image => !image.src?.includes("pages.dev") && !image.dataset.src?.includes("pages.dev")));
});

test("asset pilot rejects untrusted origins, credentials, unsafe schemes and mismatched asset hosts", () => {
  const source = "images/optimized/nknk/mobile/1.webp";
  const cases = [
    { ...pilotConfig(), origin: "http://station-assets.pages.dev" },
    { ...pilotConfig(), origin: "https://station-assets.pages.dev.evil.example" },
    { ...pilotConfig(), origin: "https://user:secret@station-assets.pages.dev" },
    { ...pilotConfig(), origin: "https://station-assets.pages.dev:8443" },
    { ...pilotConfig(), origin: "https://station-assets.pages.dev/extra" },
    ...["https://another.pages.dev/assets/1.webp", "https://user:secret@station-assets.pages.dev/assets/1.webp", "javascript:alert(1)", "//station-assets.pages.dev/assets/1.webp", "https://station-assets.pages.dev/elsewhere/1.webp"].map(target => ({
      ...pilotConfig(), thumbnails: { [source]: target }
    }))
  ];
  for (const assetPilot of cases) {
    const app = galleryFixture({ assetPilot });
    assert.equal(app.root.querySelectorAll("img")[0].src, "images/optimized/nknk/1.webp");
  }
});

test("the shipped asset pilot config matches exported bytes and adds its origin only to image CSP", async () => {
  const os = require("node:os");
  const path = require("node:path");
  const { createHash } = require("node:crypto");
  const { buildAssetPilot, PILOT_SOURCES } = await import("../build-asset-pilot.mjs");
  const repo = path.resolve(__dirname, "../..");
  const configSource = fs.readFileSync(path.join(repo, "js/config.js"), "utf8");
  const readConfig = hostname => {
    const context = { window: { location: { hostname, protocol: hostname === "osagechan.top" ? "https:" : "http:" } } };
    vm.runInNewContext(configSource, context);
    return context.window.APP_CONFIG.assetPilot;
  };
  const production = readConfig("osagechan.top");
  assert.ok(production, "production declares the bounded public asset pilot");
  assert.equal(typeof production.enabled, "boolean");
  assert.match(production.origin, /^https:\/\/[a-z0-9-]+\.pages\.dev$/u);
  const sources = Array.from({ length: 6 }, (_, index) => `images/optimized/nknk/mobile/${index + 1}.webp`);
  assert.deepEqual(Object.keys(production.thumbnails).sort(), [...sources].sort());
  for (const hostname of ["localhost", "127.0.0.1"]) {
    assert.equal(readConfig(hostname)?.enabled ?? false, false, "local previews keep their local thumbnails");
  }

  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "station-gallery-pilot-config-")));
  try {
    for (const source of [...PILOT_SOURCES, "fonts/ibm-plex-mono-OFL.txt"]) {
      const destination = path.join(temp, source);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repo, source), destination);
    }
    const exported = await buildAssetPilot(temp);
    for (const source of sources) {
      const info = exported.manifest.assets[source];
      const original = fs.readFileSync(path.join(repo, source));
      assert.equal(production.thumbnails[source], `${production.origin}/${info.path}`);
      assert.equal(info.sha256, createHash("sha256").update(original).digest("hex"));
      assert.equal(info.bytes, original.length);
      assert.deepEqual(fs.readFileSync(path.join(exported.directory, info.path)), original);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }

  const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/u)?.[1];
  assert.ok(policy);
  const directives = policy.split(";").map(part => part.trim().split(/\s+/u));
  assert.deepEqual(directives.filter(parts => parts.slice(1).includes(production.origin)).map(parts => parts[0]), ["img-src"]);
  const images = directives.find(parts => parts[0] === "img-src");
  assert.deepEqual(images.slice(1).filter(source => source.includes("pages.dev")), [production.origin], "no Pages wildcard or second resource origin is allowed");
});

test("phones get the same single-row marquee as desktop instead of the static grid", () => {
  const { root } = galleryFixture({ compact: true });
  assert.equal(root.querySelector(".nknk-compact-grid"), null);
  assert.equal(root.querySelectorAll(".nknk-marquee").length, 1);
  assert.ok(root.querySelectorAll(".nknk-marquee-item").length > 6);
  assert.equal(root.classList.contains("is-compact"), false);
});
