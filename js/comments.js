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
  const label = (zh, en) => window.siteText?.(zh, en) ?? (localStorage.getItem("language") === "en" ? en : zh);
  function render() {
    const list = document.getElementById("my-comments-list");
    if (!list) return;
    list.replaceChildren();
    for (const comment of comments.values()) {
      const item = document.createElement("li");
      const text = document.createElement("p");
      text.textContent = `${comment.nickname}：${comment.content}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-clear-button";
      button.textContent = deleting.has(comment.id) ? label("正在删除…", "Deleting…") : label("删除", "Delete");
      button.disabled = deleting.has(comment.id);
      button.setAttribute("aria-label", label("删除这条留言：", "Delete this message: ") + comment.content);
      button.addEventListener("click", () => remove(comment.id));
      item.append(text, button);
      list.append(item);
    }
    const messages = {
      idle: "", loading: label("正在加载你的留言…", "Loading your messages…"),
      empty: label("你还没有登录后发布的留言。", "You have no messages posted while signed in."),
      error: label("读取失败，请重试。", "Could not load your messages. Please retry."),
      deleteError: label("删除失败，请重试；登录过期时请重新登录。", "Could not delete. Retry, or sign in again if your session expired."),
      deleted: label("留言已删除。", "Message deleted."),
      signedOut: label("请先登录，再管理自己的留言。", "Sign in to manage your messages.")
    };
    document.getElementById("my-comments-status").textContent = messages[state] || "";
    document.getElementById("my-comments-retry").hidden = state !== "error";
    const more = document.getElementById("my-comments-more");
    more.hidden = !nextCursor;
    more.disabled = busy;
  }
  async function load(more = false) {
    if (more && (busy || !nextCursor)) return;
    const current = ++version;
    busy = true;
    state = "loading";
    if (!more) { comments.clear(); nextCursor = null; }
    render();
    try {
      const signedIn = await window.hasCommentSession?.();
      if (current !== version) return;
      document.getElementById("my-comments-controls").hidden = !signedIn;
      if (!signedIn) { state = "signedOut"; return; }
      const response = await fetch(`${api}/mine${more ? `?before=${nextCursor}` : ""}`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Could not load messages");
      const data = await response.json();
      if (!Array.isArray(data.comments)) throw new Error("Invalid messages");
      if (current !== version) return;
      for (const comment of data.comments) {
        if (!deleted.has(comment.id)) comments.set(comment.id, comment);
      }
      nextCursor = data.nextCursor;
      state = comments.size ? "idle" : "empty";
    } catch {
      if (current === version) state = "error";
    } finally {
      if (current === version) { busy = false; render(); }
    }
  }
  async function remove(id) {
    if (deleting.has(id) || !comments.has(id)) return;
    if (!confirm(label("确定删除这条留言吗？删除后无法恢复。", "Delete this message? This cannot be undone."))) return;
    const current = version;
    deleting.add(id);
    render();
    try {
      const response = await fetch(`${api}/${id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok && response.status !== 404) throw new Error("Could not delete message");
      deleted.add(id);
      comments.delete(id);
      window.removeWallMessage?.(id);
      window.dispatchEvent(new CustomEvent("commentdeleted", { detail: { id } }));
      if (current === version) state = "deleted";
    } catch {
      if (current === version) state = "deleteError";
    } finally {
      deleting.delete(id);
      render();
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("my-comments-retry").addEventListener("click", () => load());
    document.getElementById("my-comments-more").addEventListener("click", () => load(true));
    load();
  });
  window.addEventListener("authchange", () => load());
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
  const label = (zh, en) => window.siteText?.(zh, en) ?? (localStorage.getItem("language") === "en" ? en : zh);
  const panel = () => document.getElementById("admin-comments");
  function hide() {
    const element = panel();
    if (element) element.hidden = true;
    authorized = false;
    comments = [];
    nextCursor = null;
  }
  function render() {
    const element = panel();
    const list = document.getElementById("admin-comments-list");
    const status = document.getElementById("admin-comments-status");
    const retry = document.getElementById("admin-comments-retry");
    if (!element || !list || !status || !retry) return;
    list.replaceChildren();
    comments.forEach(comment => {
      const item = document.createElement("li");
      const text = document.createElement("p");
      text.textContent = `${comment.nickname}：${comment.content}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-clear-button";
      button.textContent = deleting.has(comment.id) ? label("正在删除…", "Deleting…") : label("删除", "Delete");
      button.disabled = deleting.has(comment.id);
      button.setAttribute("aria-label", label("删除这条留言：", "Delete this message: ") + comment.content);
      button.addEventListener("click", () => remove(comment.id));
      item.append(text, button);
      list.append(item);
    });
    status.textContent = error === "load" ? label("读取留言失败，请重试。", "Could not load messages. Please retry.") : error === "delete" ? label("删除失败，请重试。", "Could not delete. Please retry.") : loading ? label("正在读取留言…", "Loading messages…") : comments.length ? "" : label("暂时没有留言。", "There are no messages.");
    retry.hidden = !error;
    retry.disabled = loading;
    const more = document.getElementById("admin-comments-more");
    if (more) { more.hidden = !nextCursor; more.disabled = loading; }
  }
  async function load(more = false) {
    if (more && (loading || !nextCursor)) return;
    const current = ++version;
    loading = true;
    error = "";
    render();
    try {
      const signedIn = await window.hasCommentSession?.();
      if (current !== version) return;
      if (!signedIn) return hide();
      const response = await fetch(`${api}${more ? `?before=${nextCursor}` : ""}`, { credentials: "include", cache: "no-store" });
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
      if (current === version) { loading = false; render(); }
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
      const response = await fetch(`${api}/${id}`, { method: "DELETE", credentials: "include" });
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
