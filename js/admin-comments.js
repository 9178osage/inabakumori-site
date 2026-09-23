(() => {
  const api = `${window.APP_CONFIG.apiDomain}/api/admin/comments`;
  let comments = [];
  let loading = false;
  let version = 0;
  let authorized = false;
  let error = "";
  const deleting = new Set();
  const label = (zh, en) => window.siteText?.(zh, en) ?? (localStorage.getItem("language") === "en" ? en : zh);
  const panel = () => document.getElementById("admin-comments");
  function hide() {
    const element = panel();
    if (element) element.hidden = true;
    authorized = false;
    comments = [];
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
  }
  async function load() {
    const current = ++version;
    loading = true;
    error = "";
    render();
    try {
      const signedIn = await window.hasCommentSession?.();
      if (current !== version) return;
      if (!signedIn) return hide();
      const response = await fetch(api, { credentials: "include", cache: "no-store" });
      if (current !== version) return;
      if (response.status === 401 || response.status === 403) return hide();
      if (!response.ok) throw new Error("Could not load moderation messages");
      const data = await response.json();
      if (current !== version) return;
      if (!Array.isArray(data.comments)) throw new Error("Invalid moderation response");
      comments = data.comments;
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
    const current = version;
    deleting.add(id);
    error = "";
    render();
    try {
      const response = await fetch(`${api}/${id}`, { method: "DELETE", credentials: "include" });
      if (current !== version) return;
      if (response.status === 401 || response.status === 403) return hide();
      if (!response.ok && response.status !== 404) throw new Error("Could not delete message");
      comments = comments.filter(comment => comment.id !== id);
      window.removeWallMessage?.(id);
      render();
    } catch {
      if (current === version) error = "delete";
    } finally {
      deleting.delete(id);
      render();
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("admin-comments-retry")?.addEventListener("click", load);
    load();
  });
  window.addEventListener("authchange", () => { hide(); return load(); });
  window.addEventListener("commentposted", load);
  window.addEventListener("languagechange", render);
})();
