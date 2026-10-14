const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/experience.js", "utf8");
const fn = source.match(/function activeSectionLink\([\s\S]*?\n  }\n/);
const activeSectionLink = vm.runInNewContext(`(${fn[0]})`, { decodeURIComponent });

// Page model (document coordinates): hero 0-800, #intro 800, #artwork 2200, #songs 2900, #messages 5200, end 6400.
const tops = { intro: 800, artwork: 2200, songs: 2900, messages: 5200 };
const links = Object.keys(tops).map(id => ({ hash: `#${id}`, id }));
const NAV = 72, VIEW = 800, HEIGHT = 6400;
const at = scrollY => activeSectionLink(links, NAV, VIEW, scrollY, HEIGHT,
  id => tops[id] === undefined ? null : { getBoundingClientRect: () => ({ top: tops[id] - scrollY }) })?.id ?? null;

test("section highlight follows the scroll position in both directions (songs -> artwork -> songs)", () => {
  assert.equal(at(3200), "songs");
  assert.equal(at(2300), "artwork", "scrolled back up into artwork");
  assert.equal(at(3200), "songs", "scrolling back down must return to songs, not stay on artwork");
  // Same sequence at fine granularity, both directions: state depends only on position.
  const expected = y => Object.keys(tops).filter(id => tops[id] - y <= NAV + 24).pop() ?? null;
  for (let y = 0; y <= HEIGHT - VIEW - 10; y += 37) assert.equal(at(y), expected(y), `down ${y}`);
  for (let y = HEIGHT - VIEW - 10; y >= 0; y -= 41) assert.equal(at(y), expected(y), `up ${y}`);
});

test("hero has no current section, Intro is the anchor inside #about, and page bottom selects the last section", () => {
  assert.equal(at(0), null);
  assert.equal(at(900), "intro");
  assert.equal(at(1400 - NAV), "intro");
  assert.equal(at(HEIGHT - VIEW), "messages");
});

test("scroll-linked observers read the latest entry, not the first", () => {
  const experience = fs.readFileSync("js/experience.js", "utf8");
  const script = fs.readFileSync("script.js", "utf8");
  const gallery = fs.readFileSync("js/nknk-gallery-ui.js", "utf8");
  assert.match(experience, /entries\[entries\.length - 1\]\.isIntersecting/);
  assert.match(script, /wallInView = entries\[entries\.length - 1\]\.isIntersecting/);
  assert.match(gallery, /sectionVisible = entries\[entries\.length - 1\]\.isIntersecting/);
  assert.doesNotMatch(experience, /rootMargin: "-15% 0px -55% 0px"/, "nav highlight must not depend on intersection deltas");
});
