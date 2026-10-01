// Preferences must never prevent the site from opening in private/restricted browsers.
(() => {
  const memory = new Map();
  window.siteStorage = {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      try { return localStorage.getItem(key); }
      catch { return memory.get(key) ?? null; }
    },
    setItem(key, value) {
      memory.set(key, String(value));
      try { localStorage.setItem(key, String(value)); } catch { /* In-memory fallback. */ }
    }
  };
  const theme = window.siteStorage.getItem("theme");
  const resolved = ["light", "dark"].includes(theme)
    ? theme : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  const themeColor = typeof document.querySelector === "function" ? document.querySelector('meta[name="theme-color"]') : null;
  if (themeColor) themeColor.setAttribute("content", resolved === "dark" ? "#171b1f" : "#c4c4c0");
})();
