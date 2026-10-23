(() => {
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  function commentExcerpt(content) {
    // Keep emoji sequences and combining marks intact; older browsers still preserve surrogate pairs.
    const characters = segmenter ? Array.from(segmenter.segment(content), part => part.segment) : Array.from(content);
    return characters.slice(0, 40).join("") + (characters.length > 40 ? "…" : "");
  }

  // Reuse each row so translations, pagination and pending deletes keep the focused button.
  function commentListView(listId, statusId, showIdentity = false) {
    const rows = new Map();
    let order = [];
    return (comments, deleting, label, remove) => {
      const list = document.getElementById(listId);
      if (!list) return;
      const focusedId = order.find(id => rows.get(id)?.button === document.activeElement);
      const previousOrder = order;
      order = comments.map(comment => comment.id);
      const retained = new Set(order);
      for (const [id, row] of rows) {
        if (!retained.has(id)) { row.item.remove(); rows.delete(id); }
      }
      comments.forEach((comment, index) => {
        let row = rows.get(comment.id);
        if (!row) {
          const item = document.createElement("li");
          const text = document.createElement("p");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "tag-clear-button";
          button.addEventListener("click", () => remove(comment.id));
          item.append(text, button);
          row = { item, text, button };
          rows.set(comment.id, row);
        }
        const identity = showIdentity && typeof comment.isGuest === "boolean"
          ? window.siteIdentityLabel?.(comment.isGuest) ?? (comment.isGuest ? label(" [游客]", " [Guest]") : label(" [已登录]", " [Signed in]")) : "";
        row.text.textContent = `${comment.nickname}${identity}：${comment.content}`;
        row.button.textContent = deleting.has(comment.id) ? label("正在删除…", "Deleting…") : label("删除", "Delete");
        // Keep it focusable while the request is pending; remove() already blocks duplicate activation.
        row.button.setAttribute("aria-disabled", String(deleting.has(comment.id)));
        row.button.setAttribute("aria-label", label("删除这条留言：", "Delete this message: ") + commentExcerpt(comment.content));
        if (list.children[index] !== row.item) list.insertBefore(row.item, list.children[index] || null);
      });
      if (focusedId === undefined || list.closest?.("[hidden]")) return;
      let target = rows.get(focusedId)?.button;
      if (!target) {
        const index = previousOrder.indexOf(focusedId);
        const neighbor = previousOrder.slice(index + 1).find(id => retained.has(id)) ??
          previousOrder.slice(0, index).reverse().find(id => retained.has(id)) ?? order[0];
        target = rows.get(neighbor)?.button;
      }
      if (!target) {
        target = document.getElementById(statusId);
        target?.setAttribute("tabindex", "-1");
      }
      if (target && document.activeElement !== target) target.focus?.({ preventScroll: true });
    };
  }

  // "Load more" stays focusable while busy (aria-disabled; load() already blocks duplicates). When the
  // page arrives and the button hides, hand focus to the first new message instead of dropping it on <body>.
  function loadMoreFocus(listId, moreId) {
    return () => {
      const list = document.getElementById(listId);
      const more = document.getElementById(moreId);
      if (!list || !more || document.activeElement !== more) return () => {};
      // Remember the rows already on screen. Comparing counts instead cannot tell an empty page apart
      // from a page that replaced a row deleted mid-request, because both leave the length unchanged.
      const known = new Set([...list.children]);
      return () => {
        const active = document.activeElement;
        if (active !== more && active !== document.body) return;
        if (list.closest?.("[hidden]")) return;
        if (!more.hidden) { if (active !== more) more.focus?.({ preventScroll: true }); return; }
        // Only the rows this page appended are new. An empty last page appends nothing, so focus belongs
        // on the list itself rather than on a row the reader has already seen.
        const firstNew = [...list.children].find(item => !known.has(item));
        let target = firstNew?.querySelector?.("button") ?? firstNew?.children?.[1];
        if (!target) {
          target = list;
          list.setAttribute("tabindex", "-1");
        }
        target.focus?.({ preventScroll: true });
      };
    };
  }

(() => {
  if (!document.getElementById("my-comments-list")) return;
  const api = `${window.APP_CONFIG.apiDomain}/api/comments`;
  let version = 0;
  let busy = false;
  let nextCursor = null;
  let state = "idle";
  const comments = new Map();
  const deleting = new Set();
  const deleted = new Set();
  const label = (zh, en) => window.siteText?.(zh, en) ?? ((window.siteStorage || localStorage).getItem("language") === "en" ? en : zh);
  const renderList = commentListView("my-comments-list", "my-comments-status");
  const watchMore = loadMoreFocus("my-comments-list", "my-comments-more");
  function render() {
    const list = document.getElementById("my-comments-list");
    if (!list) return;
    renderList([...comments.values()], deleting, label, remove);
    const messages = {
      idle: "", loading: label("正在加载你的留言…", "Loading your messages…"),
      empty: label("你还没有登录后发布的留言。", "You haven’t posted any messages while signed in yet."),
      error: label("读取失败，请重试。", "Could not load your messages. Please retry."),
      deleteError: label("删除失败，请重试；登录过期时请重新登录。", "Could not delete. Retry, or sign in again if your session expired."),
      deleted: label("留言已删除。", "Message deleted."),
      signedOut: label("请先登录，再管理自己的留言。", "Sign in to manage your messages.")
    };
    document.getElementById("my-comments-status").textContent = messages[state] || "";
    document.getElementById("my-comments-retry").hidden = state !== "error";
    const more = document.getElementById("my-comments-more");
    more.hidden = !nextCursor;
    more.setAttribute("aria-disabled", String(busy));
  }
  async function load(more = false, reset = false) {
    if (more && (busy || !nextCursor)) return;
    const restoreFocus = more ? watchMore() : () => {};
    const current = ++version;
    busy = true;
    state = "loading";
    if (!more) nextCursor = null;
    if (reset) comments.clear();
    render();
    try {
      const signedIn = await window.hasCommentSession?.();
      if (current !== version) return;
      document.getElementById("my-comments-controls").hidden = !signedIn;
      if (!signedIn) { comments.clear(); nextCursor = null; state = "signedOut"; return; }
      const response = await (window.siteFetch || fetch)(`${api}/mine${more ? `?before=${nextCursor}` : ""}`, { credentials: "include", cache: "no-store" });
      if (current !== version) return;
      // A dead session (401) is not a load failure: the list belonged to that session, so drop it and
      // show the sign-in state. A refused request (403) is not a dead session either — fall through to
      // the error path, which keeps the messages already on screen and offers the retry button.
      if (response.status === 401) {
        comments.clear();
        nextCursor = null;
        document.getElementById("my-comments-controls").hidden = true;
        state = "signedOut";
        return;
      }
      if (!response.ok) throw new Error("Could not load messages");
      const data = await response.json();
      if (!Array.isArray(data.comments)) throw new Error("Invalid messages");
      if (current !== version) return;
      if (!more) comments.clear();
      for (const comment of data.comments) {
        if (!deleted.has(comment.id)) comments.set(comment.id, comment);
      }
      nextCursor = data.nextCursor;
      state = comments.size ? "idle" : "empty";
    } catch {
      if (current === version) state = "error";
    } finally {
      if (current === version) { busy = false; render(); restoreFocus(); }
    }
  }
  async function remove(id) {
    if (deleting.has(id) || !comments.has(id)) return;
    if (!confirm(label("确定删除这条留言吗？删除后无法恢复。", "Delete this message? This cannot be undone."))) return;
    const current = version;
    deleting.add(id);
    render();
    try {
      const response = await (window.siteFetch || fetch)(`${api}/${id}`, { method: "DELETE", credentials: "include" });
      // Only a lost session hides the panel: 401 means the session is gone, while 403 is the server
      // refusing this one request (for example someone else's message). That is a failed delete, so
      // it falls through to the error path below and the reader keeps seeing their list.
      // A late 401 from a session that already ended must not touch a panel a newer load owns.
      if (response.status === 401) {
        if (current === version) {
          comments.clear();
          nextCursor = null;
          document.getElementById("my-comments-controls").hidden = true;
          state = "signedOut";
        }
        return;
      }
      if (!response.ok && response.status !== 404) throw new Error("Could not delete message");
      deleted.add(id);
      comments.delete(id);
      window.removeWallMessage?.(id);
      // Set the status before announcing the deletion: this panel's own listener re-renders
      // synchronously, so with the state still idle the first repaint focused an empty status node.
      if (current === version) state = "deleted";
      window.dispatchEvent(new CustomEvent("commentdeleted", { detail: { id } }));
    } catch {
      if (current === version) state = "deleteError";
    } finally {
      deleting.delete(id);
      // Render the current load's data; even a newer refresh must clear this button's pending state.
      render();
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("my-comments-retry").addEventListener("click", () => load());
    document.getElementById("my-comments-more").addEventListener("click", () => load(true));
    load();
  });
  window.addEventListener("authchange", () => load(false, true));
  window.addEventListener("commentposted", () => load());
  window.addEventListener("commentdeleted", ({ detail }) => {
    const id = detail?.id;
    if (!Number.isSafeInteger(id) || id <= 0) return;
    deleted.add(id);
    if (comments.delete(id) && !busy) state = "deleted";
    render();
  });
  window.addEventListener("languagechange", render);
})();

(() => {
  if (!document.getElementById("admin-comments-list")) return;
  const api = `${window.APP_CONFIG.apiDomain}/api/admin/comments`;
  let comments = [];
  let loading = false;
  let version = 0;
  let nextCursor = null;
  const deleted = new Set();
  let authorized = false;
  let authVersion = 0;
  let error = "";
  const deleting = new Set();
  const label = (zh, en) => window.siteText?.(zh, en) ?? ((window.siteStorage || localStorage).getItem("language") === "en" ? en : zh);
  const panel = () => document.getElementById("admin-comments");
  function hide() {
    const element = panel();
    if (element) element.hidden = true;
    authorized = false;
    comments = [];
    nextCursor = null;
  }
  const renderList = commentListView("admin-comments-list", "admin-comments-status", true);
  const watchMore = loadMoreFocus("admin-comments-list", "admin-comments-more");
  function render() {
    const element = panel();
    const list = document.getElementById("admin-comments-list");
    const status = document.getElementById("admin-comments-status");
    const retry = document.getElementById("admin-comments-retry");
    if (!element || !list || !status || !retry) return;
    renderList(comments, deleting, label, remove);
    status.textContent = error === "load" ? label("读取留言失败，请重试。", "Could not load messages. Please retry.") : error === "delete" ? label("删除失败，请重试。", "Could not delete. Please retry.") : loading ? label("正在读取留言…", "Loading messages…") : comments.length ? "" : label("暂时没有留言。", "There are no messages.");
    retry.hidden = !error;
    retry.disabled = loading;
    const more = document.getElementById("admin-comments-more");
    if (more) { more.hidden = !nextCursor; more.setAttribute("aria-disabled", String(loading)); }
  }
  async function load(more = false) {
    if (more && (loading || !nextCursor)) return;
    const restoreFocus = more ? watchMore() : () => {};
    const current = ++version;
    loading = true;
    error = "";
    render();
    try {
      const signedIn = await window.hasCommentSession?.();
      if (current !== version) return;
      if (!signedIn) return hide();
      const response = await (window.siteFetch || fetch)(`${api}${more ? `?before=${nextCursor}` : ""}`, { credentials: "include", cache: "no-store" });
      if (current !== version) return;
      if (response.status === 401 || response.status === 403) return hide();
      if (!response.ok) throw new Error("Could not load moderation messages");
      const data = await response.json();
      if (current !== version) return;
      if (!Array.isArray(data.comments)) throw new Error("Invalid moderation response");
      const combined = more ? [...comments, ...data.comments] : data.comments;
      comments = [...new Map(combined.filter(comment => !deleted.has(comment.id)).map(comment => [comment.id, comment])).values()];
      nextCursor = data.nextCursor ?? null;
      authorized = true;
      panel().hidden = false;
    } catch {
      if (current === version && authorized) error = "load";
    } finally {
      if (current === version) { loading = false; render(); restoreFocus(); }
    }
  }
  async function remove(id) {
    if (!authorized || deleting.has(id)) return;
    if (!confirm(label("确定删除这条留言吗？删除后无法恢复。", "Delete this message? This cannot be undone."))) return;
    const current = authVersion;
    deleting.add(id);
    error = "";
    render();
    try {
      const response = await (window.siteFetch || fetch)(`${api}/${id}`, { method: "DELETE", credentials: "include" });
      if (current !== authVersion) return;
      if (response.status === 401 || response.status === 403) return hide();
      if (!response.ok && response.status !== 404) throw new Error("Could not delete message");
      deleted.add(id);
      comments = comments.filter(comment => comment.id !== id);
      window.removeWallMessage?.(id);
      window.dispatchEvent(new CustomEvent("commentdeleted", { detail: { id } }));
      render();
    } catch {
      if (current === authVersion) error = "delete";
    } finally {
      deleting.delete(id);
      render();
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("admin-comments-retry")?.addEventListener("click", () => load());
    document.getElementById("admin-comments-more")?.addEventListener("click", () => load(true));
    load();
  });
  window.addEventListener("authchange", () => { authVersion++; hide(); return load(); });
  window.addEventListener("commentposted", () => load());
  window.addEventListener("commentdeleted", ({ detail }) => {
    const id = detail?.id;
    if (!Number.isSafeInteger(id) || id <= 0) return;
    deleted.add(id);
    comments = comments.filter(comment => comment.id !== id);
    render();
  });
  window.addEventListener("languagechange", render);
})();

})();
