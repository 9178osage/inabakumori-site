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
  document.documentElement.dataset.theme = ["light", "dark"].includes(theme)
    ? theme : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
})();
