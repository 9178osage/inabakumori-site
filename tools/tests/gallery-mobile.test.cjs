const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Small event-capable DOM fixture: run the actual gallery initializer and its event handlers.
// Image src assignment is observable, so hidden duplicate thumbnails cannot pass these checks.
function galleryFixture({ compact = true } = {}) {
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
  const window = { APP_CONFIG: {}, scrollY: 0, scrollTo() {}, addEventListener: (type, fn) => { windowEvents[type] = fn; }, matchMedia: query => {
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

test("gallery thumbnails come only from the site's own optimized folder on phones and desktop", () => {
  for (const compact of [true, false]) {
    const { root } = galleryFixture({ compact });
    const sources = root.querySelectorAll("img").map(image => image.src || image.dataset.src);
    assert.ok(sources.length > 6);
    assert.ok(sources.every(source => /^images\/optimized\/nknk\/(?:mobile\/)?\d+\.webp$/u.test(source)), `compact=${compact}: no remote or unexpected thumbnail`);
  }
});

test("phones get the same single-row marquee as desktop instead of the static grid", () => {
  const { root } = galleryFixture({ compact: true });
  assert.equal(root.querySelector(".nknk-compact-grid"), null);
  assert.equal(root.querySelector(".nknk-compact-toggle"), null, "no 'view all' toggle");
  assert.equal(root.querySelectorAll(".nknk-marquee").length, 1);
  assert.ok(root.querySelectorAll(".nknk-marquee-item").length > 6);
  assert.equal(root.classList.contains("is-compact"), false);
});
