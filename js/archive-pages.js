// Song archive pages: language and theme controls.
(() => {
  const languages = ["zh", "en", "ja"];
  const storage = window.siteStorage;
  const readLanguage = () => languages.includes(storage?.getItem("language")) ? storage.getItem("language") : "zh";
  let language = readLanguage();
  const text = (zh, en, ja) => ({ zh, en, ja })[language];
  const formatters = new Map();
  const formatTime = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    if (!formatters.has(language)) formatters.set(language, new Intl.DateTimeFormat({ zh: "zh-CN", en: "en-US", ja: "ja-JP" }[language], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }));
    return `${formatters.get(language).format(date)} JST`;
  };
  const ready = callback => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", callback, { once: true }) : callback();

  ready(() => {
    const root = document.documentElement;
    const langButton = document.getElementById("archive-lang-btn");
    const themeButton = document.getElementById("archive-theme-btn");

    function applyTheme() {
      const stored = storage?.getItem("theme");
      const theme = ["light", "dark"].includes(stored) ? stored : window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
      root.dataset.theme = theme;
      document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute("content", theme === "dark" ? "#171b1f" : "#c4c4c0"));
      if (themeButton) {
        themeButton.textContent = theme === "dark" ? "☀" : "☾";
        themeButton.setAttribute("aria-label", text("深色主题", "Dark theme", "ダークテーマ"));
        themeButton.setAttribute("aria-pressed", String(theme === "dark"));
      }
    }
    function applyLanguage() {
      root.lang = { zh: "zh-CN", en: "en", ja: "ja" }[language];
      const title = root.getAttribute(`data-title-${language}`);
      if (title) {
        document.title = title;
        document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
      }
      const description = root.getAttribute(`data-description-${language}`);
      if (description) {
        document.querySelector('meta[name="description"]')?.setAttribute("content", description);
        document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
      }
      document.querySelectorAll("[data-zh][data-en][data-ja]").forEach(element => { element.textContent = element.dataset[language]; });
      document.querySelectorAll("[data-aria-zh]").forEach(element => element.setAttribute("aria-label", element.dataset[`aria${language[0].toUpperCase()}${language.slice(1)}`] || element.dataset.ariaZh));
      document.querySelectorAll("time[data-local-time]").forEach(element => {
        const formatted = element.closest(".song-facts") ? element.textContent : formatTime(element.dateTime);
        if (formatted && element.textContent !== formatted) element.textContent = formatted;
      });
      if (langButton) {
        langButton.textContent = { zh: "English", en: "日本語", ja: "中文" }[language];
        langButton.setAttribute("aria-label", text("English — 切换语言，当前：中文", "日本語 — Switch language, current: English", "中文 — 言語を切り替え、現在：日本語"));
      }
      applyTheme();
    }
    langButton?.addEventListener("click", () => {
      language = languages[(languages.indexOf(language) + 1) % languages.length];
      storage?.setItem("language", language);
      applyLanguage();
    });
    themeButton?.addEventListener("click", () => {
      storage?.setItem("theme", root.dataset.theme === "dark" ? "light" : "dark");
      applyTheme();
    });
    window.addEventListener("storage", event => {
      try { if (event.storageArea !== window.localStorage) return; } catch { return; }
      if (event.key === "language" || event.key === null) { language = readLanguage(); applyLanguage(); }
      else if (event.key === "theme") applyTheme();
    });

    document.querySelector(".page-controls")?.removeAttribute("hidden");
    applyLanguage();
  });
})();
