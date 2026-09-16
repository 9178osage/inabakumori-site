(() => {
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
  window.addEventListener("languagechange", render);
})();
