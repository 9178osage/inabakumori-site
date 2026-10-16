const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function ui(ids = [1, 2, 3], cursor = null) {
  const events = {}, listeners = {};
  const listen = (name, fn) => {
    (listeners[name] ||= []).push(fn);
    events[name] = event => Promise.all(listeners[name].map(listener => listener(event)));
  };
  const document = { addEventListener: listen };
  function element(tagName = "div") {
    let disabled = false;
    return {
      tagName, hidden: false, children: [], parentElement: null, listeners: {}, attributes: {}, textContent: "",
      get disabled() { return disabled; },
      set disabled(value) {
        disabled = value;
        if (value && document.activeElement === this) document.activeElement = document.body;
      },
      get lastElementChild() { return this.children[this.children.length - 1] ?? null; },
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const index = this.parentElement.children.indexOf(this);
        return index >= 0 ? (this.parentElement.children[index + 1] ?? null) : null;
      },
      contains(node) { return node === this || this.children.some(child => child.contains(node)); },
      closest() { for (let node = this; node; node = node.parentElement) if (node.hidden) return node; return null; },
      focus() { if (!this.disabled && !this.closest() && document.body.contains(this)) document.activeElement = this; },
      remove() {
        if (!this.parentElement) return;
        if (this.contains(document.activeElement)) document.activeElement = document.body;
        const siblings = this.parentElement.children;
        siblings.splice(siblings.indexOf(this), 1); this.parentElement = null;
      },
      append(...children) { children.forEach(child => this.insertBefore(child, null)); },
      insertBefore(child, before) {
        child.remove();
        this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
        child.parentElement = this;
      },
      replaceChildren(...children) { [...this.children].forEach(child => child.remove()); this.append(...children); },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, fn) { this.listeners[name] = fn; }
    };
  }
  document.body = element("body");
  document.activeElement = document.body;
  const names = ["my-comments", "my-comments-controls", "my-comments-list", "my-comments-status", "my-comments-retry", "my-comments-more",
    "admin-comments", "admin-comments-list", "admin-comments-status", "admin-comments-retry", "admin-comments-more", "outside"];
  const elements = Object.fromEntries(names.map(name => [name, element()]));
  for (const panel of ["my-comments", "admin-comments"]) {
    const container = elements[panel];
    document.body.append(container);
    container.append(elements[`${panel}-status`], elements[`${panel}-retry`]);
    if (panel === "my-comments") {
      container.append(elements[`${panel}-controls`]);
      elements[`${panel}-controls`].append(elements[`${panel}-list`], elements[`${panel}-more`]);
    } else container.append(elements[`${panel}-list`], elements[`${panel}-more`]);
  }
  document.body.append(elements.outside);
  document.getElementById = id => elements[id];
  document.createElement = element;
  const rows = ids.map(id => ({ id, nickname: "fan", content: `message ${id}` }));
  const reply = () => ({ ok: true, json: async () => ({ comments: rows, nextCursor: cursor }) });
  const context = {
    document, CustomEvent, confirm: () => true, localStorage: { getItem: () => "en" }, fetch: async () => reply(),
    window: { APP_CONFIG: { apiDomain: "" }, hasCommentSession: async () => true, addEventListener: listen,
      dispatchEvent: event => events[event.type]?.(event) }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/comments.js", "utf8"), context);
  await events.authchange();
  const button = (panel, id) => elements[`${panel}-list`].children.find(item => item.children[0].textContent === `fan：message ${id}`)?.children[1];
  return { context, document, elements, events, rows, reply, button };
}

for (const panel of ["my-comments", "admin-comments"]) {
  test(`${panel}: failed deletion and translation keep the original focused button`, async () => {
    const app = await ui();
    const original = app.button(panel, 2);
    original.focus();
    let finish, calls = 0;
    app.context.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const pending = original.listeners.click();
    assert.equal(app.document.activeElement, original);
    assert.equal(app.button(panel, 2), original);
    assert.equal(original.attributes["aria-disabled"], "true");
    await app.events.languagechange();
    await original.listeners.click();
    assert.equal(calls, 1);
    assert.equal(app.document.activeElement, original);
    finish({ ok: false, status: 500 });
    await pending;
    assert.equal(app.document.activeElement, original);
    assert.equal(app.button(panel, 2), original);
    assert.equal(original.attributes["aria-disabled"], "false");
  });

  test(`${panel}: successful deletion focuses the next, previous, or empty status`, async () => {
    for (const [ids, removeId, nextId] of [[[1, 2, 3], 2, 3], [[1, 2, 3], 3, 2], [[1], 1, null]]) {
      const app = await ui(ids);
      const original = app.button(panel, removeId);
      original.focus();
      app.context.fetch = async () => ({ ok: true });
      await original.listeners.click();
      const target = nextId ? app.button(panel, nextId) : app.elements[`${panel}-status`];
      assert.equal(app.document.activeElement, target);
      assert.equal(app.button(panel, removeId), undefined);
      if (!nextId) assert.equal(target.attributes.tabindex, "-1");
    }
  });

  test(`${panel}: a completed request never takes focus back after the user moves away`, async () => {
    for (const response of [{ ok: true }, { ok: false, status: 500 }]) {
      const app = await ui();
      const original = app.button(panel, 2);
      original.focus();
      let finish;
      app.context.fetch = () => new Promise(resolve => { finish = resolve; });
      const pending = original.listeners.click();
      app.elements.outside.focus();
      finish(response);
      await pending;
      assert.equal(app.document.activeElement, app.elements.outside);
    }
  });

  test(`${panel}: refreshing during a delete keeps focus and clears the pending state on failure`, async () => {
    const app = await ui();
    const original = app.button(panel, 2);
    original.focus();
    let finish;
    app.context.fetch = (_, options) => options.method === "DELETE"
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(app.reply());
    const pending = original.listeners.click();
    await app.events.commentposted();
    assert.equal(app.button(panel, 2), original);
    assert.equal(app.document.activeElement, original);
    finish({ ok: false, status: 500 });
    await pending;
    assert.equal(original.attributes["aria-disabled"], "false");
    assert.equal(app.document.activeElement, original);
  });

  test(`${panel}: reordered refreshes preserve focus and cross-panel deletion moves it once`, async () => {
    const app = await ui();
    const original = app.button(panel, 2);
    original.focus();
    app.rows.reverse();
    await app.events.commentposted();
    assert.equal(app.button(panel, 2), original);
    assert.equal(app.document.activeElement, original);
    const other = panel === "my-comments" ? "admin-comments" : "my-comments";
    app.context.fetch = async () => ({ ok: true });
    await app.button(other, 2).listeners.click();
    assert.equal(app.document.activeElement, app.button(panel, 1));
  });

  test(`${panel}: a stale deletion after sign-out cannot reclaim focus or reveal old rows`, async () => {
    const app = await ui();
    const original = app.button(panel, 2);
    original.focus();
    let finish;
    app.context.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = original.listeners.click();
    app.context.window.hasCommentSession = async () => false;
    await app.events.authchange();
    app.elements.outside.focus();
    finish({ ok: false, status: 401 });
    await pending;
    assert.equal(app.document.activeElement, app.elements.outside);
    assert.equal(app.elements[`${panel}-list`].children.length, 0);
    assert.equal(app.elements[panel === "my-comments" ? "my-comments-controls" : "admin-comments"].hidden, true);
  });
}

for (const panel of ["my-comments", "admin-comments"]) {
  const page = (ids, nextCursor) => ({ ok: true, json: async () => ({
    comments: ids.map(id => ({ id, nickname: "fan", content: `message ${id}` })), nextCursor }) });

  // The button is only focusable once the first page rendered. If that focus() had silently failed,
  // loadMoreFocus() would hand back a no-op and every assertion below would pass for the wrong reason,
  // so wait for the button to actually hold focus and prove it before clicking.
  const loaded = async () => {
    const app = await ui([1, 2], 2);
    await app.events.DOMContentLoaded();
    await new Promise(setImmediate);
    const more = app.elements[`${panel}-more`];
    for (let wait = 0; wait < 40 && app.document.activeElement !== more; wait++) {
      more.focus();
      await new Promise(setImmediate);
    }
    assert.equal(app.document.activeElement, more, "the load-more button must hold focus before the click");
    return { app, more };
  };

  test(`${panel}: load more keeps focus on the button while pending and after another page`, async () => {
    const { app, more } = await loaded();
    let finish, calls = 0;
    app.context.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const pending = more.listeners.click();
    await new Promise(setImmediate);
    assert.equal(app.document.activeElement, more);
    assert.equal(more.attributes["aria-disabled"], "true");
    await more.listeners.click();
    assert.equal(calls, 1);
    finish(page([3], 3));
    await pending;
    assert.equal(more.hidden, false);
    assert.equal(more.attributes["aria-disabled"], "false");
    assert.equal(app.document.activeElement, more);
  });

  test(`${panel}: load more moves focus to the first new message when the button hides`, async () => {
    const { app, more } = await loaded();
    app.context.fetch = async () => page([3, 4], null);
    await more.listeners.click();
    assert.equal(more.hidden, true);
    assert.equal(app.document.activeElement, app.button(panel, 3));
  });

  test(`${panel}: a row removed mid-request keeps load-more focus on the new message`, async () => {
    const { app, more } = await loaded();
    const list = app.elements[`${panel}-list`];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    app.context.fetch = async () => { await gate; return page([3], null); };
    const clicking = more.listeners.click();
    await new Promise(setImmediate);
    // A row disappears through the real event while the page request is in flight.
    app.context.window.dispatchEvent(new CustomEvent("commentdeleted", { detail: { id: 2 } }));
    release();
    await clicking;
    assert.equal(more.hidden, true);
    assert.notEqual(app.document.activeElement, list, "focus must not fall back to the whole list");
    assert.equal(app.document.activeElement, app.button(panel, 3));
  });

  test(`${panel}: an empty last page focuses the list, not the body`, async () => {
    const { app, more } = await loaded();
    const list = app.elements[`${panel}-list`];
    app.context.fetch = async () => page([], null);
    await more.listeners.click();
    assert.equal(more.hidden, true);
    assert.equal(app.document.activeElement, list);
    assert.equal(list.attributes.tabindex, "-1");
  });

  test(`${panel}: a failed load more keeps focus on the button`, async () => {
    const { app, more } = await loaded();
    app.context.fetch = async () => ({ ok: false, status: 500 });
    await more.listeners.click();
    assert.equal(more.hidden, false);
    assert.equal(app.document.activeElement, more);
    assert.notEqual(app.document.activeElement, app.document.body);
  });

  test(`${panel}: load more does not pull focus back after the user moves away`, async () => {
    const { app, more } = await loaded();
    let finish;
    app.context.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = more.listeners.click();
    await new Promise(setImmediate);
    app.elements.outside.focus();
    finish(page([3], null));
    await pending;
    assert.equal(app.document.activeElement, app.elements.outside);
  });
}
