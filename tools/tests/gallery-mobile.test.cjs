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

test("mobile gallery creates only six lazy small thumbnails until the visitor expands it", () => {
  const { root, document, window, context, intervalCount } = galleryFixture();
  let buttons = root.querySelectorAll(".nknk-marquee-item");
  assert.equal(buttons.length, 6);
  assert.equal(root.querySelectorAll("[aria-hidden='true']").length, 0);
  assert.equal(intervalCount(), 0, "static mobile gallery needs no marquee polling timer");
  for (const image of root.querySelectorAll("img")) {
    assert.match(image.src, /\/nknk\/mobile\//);
    assert.equal(image.loading, "lazy");
  }
  const toggle = root.querySelector(".nknk-compact-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.dispatch("click", { detail: 0 });
  buttons = root.querySelectorAll(".nknk-marquee-item");
  assert.equal(buttons.length, window.NKNK_GALLERY.length);
  assert.equal(document.activeElement, buttons[6]);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  context.currentLanguage = "en";
  toggle.dispatch("click", { detail: 0 });
  assert.equal(root.querySelectorAll(".nknk-marquee-item").length, 6);
  assert.equal(document.activeElement, toggle);
  assert.equal(toggle.textContent, "View all 107 illustrations");
  assert.equal(root.querySelectorAll(".nknk-marquee-item").filter(button => button.tabIndex === 0).length, 1);
});

function pilotConfig() {
  const origin = "https://station-assets.pages.dev";
  return { enabled: true, origin, thumbnails: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
    `images/optimized/nknk/mobile/${index + 1}.webp`, `${origin}/assets/${index + 1}-0123456789ab.webp`
  ])) };
}

test("asset pilot requests only six mobile thumbnails and keeps full images and later entries local", () => {
  const assetPilot = pilotConfig();
  const app = galleryFixture({ assetPilot });
  const images = app.root.querySelectorAll("img");
  assert.equal(images.length, 6, "do not create or warm all gallery assets");
  images.forEach((image, index) => {
    assert.equal(image.src, assetPilot.thumbnails[`images/optimized/nknk/mobile/${index + 1}.webp`]);
    assert.equal(image.loading, "lazy");
    assert.equal(image.fetchPriority, "low");
  });
  app.root.querySelectorAll(".nknk-marquee-item")[0].dispatch("click", { detail: 1 });
  assert.equal(app.ids["nknk-lightbox-image"].src, app.window.NKNK_GALLERY[0].full);
  app.ids["nknk-lightbox-close"].dispatch("click");
  app.root.querySelector(".nknk-compact-toggle").dispatch("click", { detail: 0 });
  assert.equal(app.root.querySelectorAll("img")[6].src, "images/optimized/nknk/mobile/7.webp", "even an extra configured mapping cannot expand the pilot");
});

test("asset pilot is inactive without an enabled config and never alters desktop thumbnails", () => {
  for (const assetPilot of [undefined, { ...pilotConfig(), enabled: false }]) {
    const app = galleryFixture({ assetPilot });
    assert.equal(app.root.querySelectorAll("img")[0].src, "images/optimized/nknk/mobile/1.webp");
  }
  const desktop = galleryFixture({ assetPilot: pilotConfig(), compact: false });
  assert.equal(desktop.root.querySelectorAll("img")[0].src, "images/optimized/nknk/1.webp");
  assert.ok(desktop.root.querySelectorAll("img").every(image => !image.src?.includes("pages.dev") && !image.dataset.src?.includes("pages.dev")));
});

test("a failed pilot thumbnail falls back once and future mobile mounts keep that image local", () => {
  const app = galleryFixture({ assetPilot: pilotConfig() });
  const image = app.root.querySelectorAll("img")[0];
  let current = image.src;
  const assignments = [];
  Object.defineProperty(image, "src", { get: () => current, set(value) { current = value; assignments.push(value); } });
  image.dispatch("error");
  image.dispatch("error");
  image.dispatch("error");
  image.dispatch("error");
  assert.deepEqual(assignments, ["images/optimized/nknk/mobile/1.webp", "images/optimized/nknk/1.webp"],
    "Pages failure falls back to the local mobile file, then the original thumbnail, and never loops");
  const compact = [...app.media.values()].find(query => query.matches);
  compact.matches = false; compact.changed();
  compact.matches = true; compact.changed();
  const remounted = app.root.querySelectorAll("img");
  assert.equal(remounted[0].src, "images/optimized/nknk/mobile/1.webp");
  assert.equal(remounted[1].src, pilotConfig().thumbnails["images/optimized/nknk/mobile/2.webp"], "only the failed asset is excluded");
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
    assert.equal(app.root.querySelectorAll("img")[0].src, source);
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

test("compact gallery keeps keyboard navigation, all lightbox images and focus return", () => {
  const { root, ids, document, window, docEvents } = galleryFixture();
  const buttons = root.querySelectorAll(".nknk-marquee-item");
  buttons[0].focus();
  buttons[0].dispatch("keydown", { key: "ArrowDown" });
  assert.equal(document.activeElement, buttons[3], "arrow down advances one grid row");
  buttons[5].dispatch("click", { detail: 1 });
  assert.equal(ids["nknk-lightbox"].hidden, false);
  assert.equal(ids["nknk-lightbox-image"].src, window.NKNK_GALLERY[5].full);
  ids["nknk-lightbox-next"].dispatch("click");
  assert.equal(ids["nknk-lightbox-image"].src, window.NKNK_GALLERY[6].full, "lightbox can view beyond the six-item preview");
  docEvents.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(ids["nknk-lightbox"].hidden, true);
  assert.equal(document.activeElement, buttons[5]);
  assert.equal(root.querySelectorAll(".nknk-marquee-item").filter(button => button.tabIndex === 0).length, 1);
});

test("crossing the mobile breakpoint preserves the lightbox return target", () => {
  const { root, ids, document, media } = galleryFixture();
  const compactMedia = [...media.values()].find(query => query.matches);
  root.querySelectorAll(".nknk-marquee-item")[3].dispatch("click", { detail: 1 });
  compactMedia.matches = false; compactMedia.changed();
  assert.equal(root.querySelectorAll(".nknk-marquee-item").length, 214, "desktop keeps its full seamless marquee");
  ids["nknk-lightbox-close"].dispatch("click");
  assert.equal(document.activeElement.dataset.galleryIndex, "3");
  assert.equal(document.activeElement.getAttribute("aria-hidden"), null);
  compactMedia.matches = true; compactMedia.changed();
  assert.equal(root.querySelectorAll(".nknk-marquee-item").length, 6);
  assert.equal(document.activeElement.dataset.galleryIndex, "3");
});

test("browser Back closes the compact lightbox and restores focus, scrolling and background access", () => {
  const { root, ids, document, history, flushTasks } = galleryFixture();
  const source = root.querySelectorAll(".nknk-marquee-item")[2];
  source.dispatch("click", { detail: 0 });
  assert.equal(history.scrollRestoration, "manual");
  assert.equal(ids.artwork.inert, true);
  history.back();
  flushTasks();
  assert.equal(ids["nknk-lightbox"].hidden, true);
  assert.equal(history.scrollRestoration, "auto");
  assert.equal(document.activeElement, source);
  assert.equal(ids.artwork.inert, undefined, "restore the original background state");
  assert.equal(root.querySelectorAll(".nknk-marquee-item").length, 6);
});

test("an illustration beyond the mobile preview remains a reachable return target after resize", () => {
  const { root, ids, document, media, window } = galleryFixture();
  const compactMedia = [...media.values()].find(query => query.matches);
  compactMedia.matches = false; compactMedia.changed();
  const source = root.querySelectorAll(".nknk-marquee-item:not([aria-hidden='true'])")[42];
  source.focus();
  source.dispatch("click", { detail: 0 });
  compactMedia.matches = true; compactMedia.changed();
  assert.equal(ids["nknk-lightbox"].hidden, false);
  assert.equal(root.querySelectorAll(".nknk-marquee-item").length, window.NKNK_GALLERY.length);
  assert.equal(root.querySelector(".nknk-compact-toggle").getAttribute("aria-expanded"), "true");
  ids["nknk-lightbox-close"].dispatch("click");
  assert.equal(document.activeElement.dataset.galleryIndex, "42");
  assert.equal(root.contains(document.activeElement), true, "focus must not return to a removed desktop node");
  root.querySelector(".nknk-compact-toggle").dispatch("click", { detail: 0 });
  assert.equal(root.querySelectorAll(".nknk-marquee-item").length, 6);
  assert.equal(document.activeElement, root.querySelector(".nknk-compact-toggle"));
});

test("without the pilot a broken local mobile thumbnail falls back once to the original thumbnail", () => {
  const app = galleryFixture({ assetPilot: undefined });
  const image = app.root.querySelectorAll("img")[0];
  assert.equal(image.src, "images/optimized/nknk/mobile/1.webp");
  let current = image.src;
  const assignments = [];
  Object.defineProperty(image, "src", { get: () => current, set(value) { current = value; assignments.push(value); } });
  for (let attempt = 0; attempt < 5; attempt++) image.dispatch("error");
  assert.deepEqual(assignments, ["images/optimized/nknk/1.webp"], "one bounded fallback, no retry loop");
});
