(() => {
  function initializeUpdates() {
    const languages = ["zh", "en", "ja"];
    const storage = window.siteStorage;
    const readLanguage = () => languages.includes(storage.getItem("language")) ? storage.getItem("language") : "zh";
    let language = readLanguage();
    let filter = "all";
    const langButton = document.getElementById("updates-lang-btn");
    const themeButton = document.getElementById("updates-theme-btn");
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    const text = (zh, en, ja) => ({ zh, en, ja })[language];

    function applyFilter() {
      const entries = [...document.querySelectorAll(".update-item[data-creator]")];
      let count = 0;
      entries.forEach(entry => {
        const shown = filter === "all" || entry.dataset.creator === filter;
        entry.hidden = !shown;
        if (shown) count++;
      });
      document.querySelectorAll("[data-filter]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
      });
      const result = document.getElementById("updates-count");
      if (result) {
        result.hidden = false;
        result.textContent = text(`已收录 ${count} 条 · 点击标题查看原始发布`, `${count} collected · Open a title for the original post`, `${count}件収録 · タイトルから元の投稿へ`);
      }
      const empty = document.getElementById("updates-empty");
      if (empty) empty.hidden = count > 0;
    }

    function applyTheme() {
      const stored = storage.getItem("theme");
      const theme = ["light", "dark"].includes(stored) ? stored : systemTheme?.matches ? "dark" : "light";
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
      document.title = text("最新动态 · 稲葉曇与 NKNK", "Latest updates · Inabakumori & NKNK", "最新情報 · 稲葉曇・ぬくぬくにぎりめし");
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = text("稲葉曇与ぬくぬくにぎりめし（NKNK）的作品动态，附官方来源与核对时间。", "New work from Inabakumori and Nukunuku Nigirimeshi (NKNK), with official sources and check times.", "稲葉曇さんとぬくぬくにぎりめしさんの作品情報。公式の取得元と確認日時を掲載。");
      document.querySelectorAll("[data-zh][data-en][data-ja]").forEach(element => {
        element.textContent = element.dataset[language];
      });
      document.querySelectorAll("[data-aria-zh]").forEach(element => {
        element.setAttribute("aria-label", element.dataset[`aria${language[0].toUpperCase()}${language.slice(1)}`] || element.dataset.ariaZh);
      });
      document.querySelectorAll("time[data-local-time]").forEach(element => {
        const date = new Date(element.dateTime);
        if (!Number.isFinite(date.getTime())) return;
        element.textContent = new Intl.DateTimeFormat({ zh: "zh-CN", en: "en-US", ja: "ja-JP" }[language], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(date) + " JST";
      });
      if (langButton) {
        langButton.textContent = { zh: "English", en: "日本語", ja: "中文" }[language];
        langButton.setAttribute("aria-label", text("English — 切换语言，当前：中文", "日本語 — Switch language, current: English", "中文 — 言語を切り替え、現在：日本語"));
      }
      applyTheme();
      applyFilter();
    }

    langButton?.addEventListener("click", () => {
      language = languages[(languages.indexOf(language) + 1) % languages.length];
      storage.setItem("language", language);
      applyLanguage();
    });
    themeButton?.addEventListener("click", () => {
      storage.setItem("theme", document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      applyTheme();
    });
    document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
      filter = button.dataset.filter;
      applyFilter();
    }));
    window.addEventListener("storage", event => {
      try { if (event.storageArea !== window.localStorage) return; } catch { return; }
      if (event.key === "language" || event.key === null) {
        language = readLanguage();
        applyLanguage();
      } else if (event.key === "theme") applyTheme();
    });
    if (systemTheme?.addEventListener) systemTheme.addEventListener("change", applyTheme);
    else systemTheme?.addListener?.(applyTheme);
    // A scheduled update can fail while an older successful snapshot remains public.
    // Derive staleness in the reader's browser as well as at build time.
    function updateStaleness() {
      document.querySelectorAll(".source-status").forEach(element => {
        const stamp = Date.parse(element.dataset.checkedAt);
        const stale = !Number.isFinite(stamp) || Date.now() - stamp > 48 * 60 * 60 * 1000;
        const notice = element.querySelector(".source-stale");
        if (notice) notice.hidden = !stale;
      });
    }
    let staleTimer = null;
    function resumePage() {
      language = readLanguage();
      applyLanguage();
      updateStaleness();
      if (staleTimer !== null) window.clearInterval(staleTimer);
      staleTimer = window.setInterval(updateStaleness, 60_000);
    }
    window.addEventListener("pagehide", () => {
      if (staleTimer !== null) window.clearInterval(staleTimer);
      staleTimer = null;
    });
    // bfcache can restore this document after preferences changed in another page.
    window.addEventListener("pageshow", resumePage);
    resumePage();
    document.querySelector(".page-controls")?.removeAttribute("hidden");
    document.querySelector(".updates-filters")?.removeAttribute("hidden");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeUpdates, { once: true });
  else initializeUpdates();
})();
