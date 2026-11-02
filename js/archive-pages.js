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
      document.querySelectorAll(".x-post-translation[data-en]:not([data-zh])").forEach(element => { element.dataset.zh = element.textContent; });
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

    // songs.html: one "Filter" menu. Choose album or year, then one value in that submenu.
    function initSongFilter() {
      const panel = document.getElementById("song-filters");
      const toggle = document.getElementById("song-filter-toggle");
      const menu = document.getElementById("song-filter-menu");
      if (!panel || !toggle || !menu) return;
      const facets = ["album", "year"];
      const items = [...document.querySelectorAll(".song-index-list li[data-album][data-year]")];
      const dropdown = panel.querySelector(".song-filter-dropdown");
      const toggleLabel = document.getElementById("song-filter-toggle-label");
      const all = document.getElementById("song-filter-all");
      const buttons = [...panel.querySelectorAll("button[data-song-filter]")];
      const modes = [...panel.querySelectorAll("button[data-song-mode]")];
      const submenus = Object.fromEntries(facets.map(facet => [facet, document.getElementById(`song-filter-${facet}`)]));
      const status = document.getElementById("song-filter-status");
      const reset = document.getElementById("song-filter-reset");
      const empty = document.getElementById("song-filter-empty");
      const known = Object.fromEntries(facets.map(facet => [facet, new Set(items.map(item => item.dataset[facet]))]));
      const filterWord = { zh: "筛选", en: "Filter", ja: "絞り込み" };
      let facet = "", value = "";
      const seen = new Set();
      for (const pair of String(window.location?.search || "").replace(/^\?/u, "").split("&")) {
        const separator = pair.indexOf("=");
        const key = separator < 0 ? pair : pair.slice(0, separator);
        // Only the first occurrence of a key counts. "all", unknown and malformed values select
        // nothing, so an old combined link falls through to its next real filter.
        if (!facets.includes(key) || seen.has(key)) continue;
        seen.add(key);
        try {
          const decoded = decodeURIComponent((separator < 0 ? "" : pair.slice(separator + 1)).replace(/\+/gu, " "));
          if (known[key].has(decoded)) {
            facet = key;
            value = decoded;
            break;
          }
        } catch { /* Ignore this key. */ }
      }
      const inside = target => Boolean(target && dropdown?.contains(target));
      function showBranch(branch) {
        for (const mode of modes) {
          const own = mode.dataset.songMode;
          mode.setAttribute("aria-expanded", String(own === branch));
          if (submenus[own]) submenus[own].hidden = own !== branch;
        }
      }
      function setOpen(open, branch = "") {
        menu.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        showBranch(open ? branch : "");
      }
      function close(returnFocus) {
        if (menu.hidden) return;
        setOpen(false);
        if (returnFocus) toggle.focus();
      }
      function render() {
        let shown = 0;
        for (const item of items) {
          const visible = !facet || item.dataset[facet] === value;
          item.hidden = !visible;
          if (visible) shown++;
        }
        all?.setAttribute("aria-pressed", String(!facet));
        for (const mode of modes) {
          if (mode.dataset.songMode === facet) mode.setAttribute("data-active", "");
          else mode.removeAttribute("data-active");
        }
        let chosen = null;
        for (const button of buttons) {
          const selected = button.dataset.songFilter === facet && button.dataset.value === value;
          button.setAttribute("aria-pressed", String(selected));
          if (selected) chosen = button;
        }
        if (chosen) toggle.setAttribute("data-active", "");
        else toggle.removeAttribute("data-active");
        if (toggleLabel) {
          // data-zh/en/ja let applyLanguage() retranslate dynamic text after a language switch.
          for (const code of languages) {
            const choice = chosen?.dataset[`label${code[0].toUpperCase()}${code.slice(1)}`];
            toggleLabel.dataset[code] = choice ? `${filterWord[code]}${code === "en" ? ": " : "："}${choice}` : filterWord[code];
          }
          toggleLabel.textContent = toggleLabel.dataset[language];
        }
        const total = items.length;
        if (status) {
          Object.assign(status.dataset, facet
            ? { zh: `显示 ${shown} / ${total} 首`, en: `Showing ${shown} of ${total} songs`, ja: `${total}曲中${shown}曲を表示` }
            : { zh: `共 ${total} 首`, en: `${total} songs`, ja: `全${total}曲` });
          status.textContent = status.dataset[language];
        }
        if (reset) reset.hidden = !facet;
        if (empty) empty.hidden = shown > 0;
      }
      function update(nextFacet, nextValue) {
        facet = nextFacet;
        value = nextValue;
        render();
        try {
          const search = facet ? `?${facet}=${encodeURIComponent(value)}` : "";
          if ((window.location?.search || "") !== search) window.history?.replaceState?.(null, "", window.location.pathname + search + window.location.hash);
        } catch { /* history unavailable: the in-page filter still applies */ }
      }
      function choose(nextFacet, nextValue) {
        update(nextFacet, nextValue);
        close(true);
      }
      toggle.addEventListener("click", () => menu.hidden ? setOpen(true, facet) : close(false));
      for (const mode of modes) {
        const branch = mode.dataset.songMode;
        if (!facets.includes(branch)) continue;
        // Clicking always opens (never collapses) the branch, so a hover-then-click stays open.
        mode.addEventListener("click", () => showBranch(branch));
        mode.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") showBranch(branch); });
      }
      all?.addEventListener("click", () => choose("", ""));
      all?.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") showBranch(""); });
      for (const button of buttons) button.addEventListener("click", () => {
        const { songFilter, value: nextValue } = button.dataset;
        if (facets.includes(songFilter) && known[songFilter].has(nextValue)) choose(songFilter, nextValue);
      });
      reset?.addEventListener("click", () => {
        update("", "");
        close(false);
        toggle.focus();
      });
      document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !menu.hidden) close(inside(document.activeElement) || document.activeElement === document.body);
      });
      document.addEventListener("click", event => { if (!inside(event.target)) close(false); });
      // Tabbing away closes the menu. A null relatedTarget (e.g. Safari not focusing a clicked
      // button) is ignored so the click can still reach the menu item.
      dropdown?.addEventListener("focusout", event => { if (event.relatedTarget && !inside(event.relatedTarget)) close(false); });
      update(facet, value);
      setOpen(false);
      panel.hidden = false;
    }

    document.querySelector(".page-controls")?.removeAttribute("hidden");
    initSongFilter();
    applyLanguage();
  });
})();
