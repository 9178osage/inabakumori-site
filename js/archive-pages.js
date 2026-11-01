// Song archive pages: language and theme controls, plus the song list filter on songs.html.
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
    // Follow OS theme changes while nothing is saved; refresh both preferences after a bfcache restore.
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (systemTheme?.addEventListener) systemTheme.addEventListener("change", applyTheme);
    else systemTheme?.addListener?.(applyTheme);
    window.addEventListener("pageshow", event => { if (event.persisted) { language = readLanguage(); applyLanguage(); } });

    // songs.html: choose year OR album, then one value within that branch.
    function initSongFilter() {
      const panel = document.getElementById("song-filters");
      if (!panel) return;
      const facets = ["album", "year"];
      const items = [...document.querySelectorAll(".song-index-list li[data-album][data-year]")];
      const buttons = [...panel.querySelectorAll("button[data-song-filter]")];
      const modes = [...panel.querySelectorAll("button[data-song-mode]")];
      const groups = Object.fromEntries(facets.map(facet => [facet, document.getElementById(`song-filter-${facet}`)]));
      const status = document.getElementById("song-filter-status");
      const reset = document.getElementById("song-filter-reset");
      const empty = document.getElementById("song-filter-empty");
      const known = Object.fromEntries(facets.map(facet => [facet, new Set(items.map(item => item.dataset[facet]))]));
      let facet = "", value = "all";
      const seen = new Set();
      for (const pair of String(window.location?.search || "").replace(/^\?/u, "").split("&")) {
        const separator = pair.indexOf("=");
        const key = separator < 0 ? pair : pair.slice(0, separator);
        // Only the first occurrence of a key counts; malformed or unknown values are ignored.
        if (!facets.includes(key) || seen.has(key)) continue;
        seen.add(key);
        try {
          const decoded = decodeURIComponent((separator < 0 ? "" : pair.slice(separator + 1)).replace(/\+/gu, " "));
          if (decoded === "all" || known[key].has(decoded)) {
            // Old combined links keep their first valid branch, never an invisible second filter.
            facet = key;
            value = decoded;
            break;
          }
        } catch { /* Keep this filter at "all". */ }
      }
      function render() {
        let shown = 0;
        for (const item of items) {
          const visible = !facet || value === "all" || item.dataset[facet] === value;
          item.hidden = !visible;
          if (visible) shown++;
        }
        for (const mode of modes) {
          const selected = mode.dataset.songMode === facet;
          mode.setAttribute("aria-pressed", String(selected));
          mode.setAttribute("aria-expanded", String(selected));
          groups[mode.dataset.songMode].hidden = !selected;
        }
        for (const button of buttons) {
          button.setAttribute("aria-pressed", String(button.dataset.songFilter === facet && button.dataset.value === value));
        }
        const total = items.length, filtered = facet && value !== "all";
        if (status) {
          // data-zh/en/ja let applyLanguage() retranslate the count after a language switch.
          Object.assign(status.dataset, filtered
            ? { zh: `显示 ${shown} / ${total} 首`, en: `Showing ${shown} of ${total} songs`, ja: `${total}曲中${shown}曲を表示` }
            : { zh: `共 ${total} 首`, en: `${total} songs`, ja: `全${total}曲` });
          status.textContent = status.dataset[language];
          status.hidden = false;
        }
        if (reset) reset.hidden = !facet;
        if (empty) empty.hidden = shown > 0;
      }
      function update(nextFacet, nextValue) {
        facet = nextFacet;
        value = nextValue;
        render();
        const query = facet ? `${facet}=${encodeURIComponent(value)}` : "";
        try {
          const search = query ? `?${query}` : "";
          if ((window.location?.search || "") !== search) window.history?.replaceState?.(null, "", window.location.pathname + search + window.location.hash);
        } catch { /* history unavailable: the in-page filter still applies */ }
      }
      for (const mode of modes) mode.addEventListener("click", () => {
        const nextFacet = mode.dataset.songMode;
        if (facets.includes(nextFacet) && nextFacet !== facet) update(nextFacet, "all");
      });
      for (const button of buttons) button.addEventListener("click", () => {
        const { songFilter, value: nextValue } = button.dataset;
        if (songFilter !== facet || (nextValue !== "all" && !known[facet].has(nextValue))) return;
        update(facet, nextValue);
      });
      reset?.addEventListener("click", () => {
        update("", "all");
        modes[0]?.focus();
      });
      update(facet, value);
      panel.hidden = false;
    }

    document.querySelector(".page-controls")?.removeAttribute("hidden");
    initSongFilter();
    applyLanguage();
  });
})();
