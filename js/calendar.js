// Secret little calendar: counts whole Japan-time days since Inabakumori's newest song.
// The release time is pre-rendered by tools/build-site.mjs from data/creator-updates.json,
// so a new upload resets the counter on the next scheduled rebuild.
(() => {
  const languages = ["zh", "en", "ja"];
  const storage = window.siteStorage;
  const readLanguage = () => languages.includes(storage?.getItem("language")) ? storage.getItem("language") : "zh";
  let language = readLanguage();
  const DAY = 86_400_000, JST = 9 * 3_600_000;
  const japanDay = time => Math.floor((time + JST) / DAY);
  const daysSince = (release, now = Date.now()) => Math.max(0, japanDay(now) - japanDay(release));
  window.inabakumoriCalendar = { daysSince };
  const ready = callback => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", callback) : callback();
  ready(() => {
    const sheet = document.querySelector(".calendar-sheet");
    const daysElement = document.getElementById("calendar-days");
    const release = Date.parse(sheet?.dataset.release || "");
    const langButton = document.getElementById("calendar-lang-btn");
    const themeButton = document.getElementById("calendar-theme-btn");
    const controls = document.querySelector(".page-controls");
    const text = (zh, en, ja) => ({ zh, en, ja })[language];
    const locale = () => ({ zh: "zh-CN", en: "en-US", ja: "ja-JP" })[language];
    function render() {
      if (!sheet || !daysElement || !Number.isFinite(release)) return;
      const days = daysSince(release);
      daysElement.textContent = String(days);
      const today = new Date();
      const format = options => new Intl.DateTimeFormat(locale(), { timeZone: "Asia/Tokyo", ...options }).format(today);
      const dateElement = document.getElementById("calendar-today");
      const weekdayElement = document.getElementById("calendar-weekday");
      if (dateElement) dateElement.textContent = format({ year: "numeric", month: "short", day: "numeric" });
      if (weekdayElement) weekdayElement.textContent = format({ weekday: "long" });
      const releaseElement = document.getElementById("calendar-release");
      if (releaseElement) releaseElement.textContent = new Intl.DateTimeFormat(locale(), { timeZone: "Asia/Tokyo", dateStyle: "long" }).format(new Date(release));
    }
    function applyTheme() {
      const stored = storage?.getItem("theme");
      const theme = ["light", "dark"].includes(stored) ? stored : window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute("content", theme === "dark" ? "#171b1f" : "#c4c4c0"));
      if (themeButton) {
        themeButton.textContent = theme === "dark" ? "☀" : "☾";
        themeButton.setAttribute("aria-label", text("深色主题", "Dark theme", "ダークテーマ"));
        themeButton.setAttribute("aria-pressed", String(theme === "dark"));
      }
    }
    function applyLanguage() {
      document.documentElement.lang = { zh: "zh-CN", en: "en", ja: "ja" }[language];
      document.title = text("神秘小日历 · 气象观测站", "Secret little calendar · Weather Observation Station", "ひみつの日めくり · 気象観測所");
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = text("气象观测站的神秘小日历。", "The Weather Observation Station's secret little calendar.", "気象観測所のひみつの日めくり。");
      document.querySelectorAll("[data-zh]").forEach(element => { element.textContent = element.dataset[language] ?? element.dataset.zh; });
      document.querySelectorAll("[data-aria-zh]").forEach(element => element.setAttribute("aria-label", element.dataset[`aria${language[0].toUpperCase()}${language.slice(1)}`] || element.dataset.ariaZh));
      if (langButton) {
        langButton.textContent = { zh: "English", en: "日本語", ja: "中文" }[language];
        langButton.setAttribute("aria-label", text("English — 切换语言，当前：中文", "日本語 — Switch language, current: English", "中文 — 言語を切り替え、現在：日本語"));
      }
      applyTheme();
      render();
    }
    langButton?.addEventListener("click", () => {
      language = languages[(languages.indexOf(language) + 1) % languages.length];
      storage?.setItem("language", language);
      applyLanguage();
    });
    themeButton?.addEventListener("click", () => {
      storage?.setItem("theme", document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      applyTheme();
    });
    window.addEventListener("storage", event => {
      try { if (event.storageArea !== window.localStorage) return; } catch { return; }
      if (event.key === "language" || event.key === null) { language = readLanguage(); applyLanguage(); }
      else if (event.key === "theme") applyTheme();
    });
    // Turn the page at the next Japan midnight, and again whenever the tab comes back.
    let timer = null;
    function schedule() {
      if (timer !== null) window.clearTimeout(timer);
      const now = Date.now();
      timer = window.setTimeout(() => { render(); schedule(); }, (japanDay(now) + 1) * DAY - JST - now + 1000);
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { render(); schedule(); } });
    if (controls) controls.hidden = false;
    sheet?.setAttribute("data-flip", "");
    applyLanguage();
    schedule();
  });
})();
