// Song archive and post search pages: language/theme controls plus the client-side search.
// Every piece of post text is written with textContent; nothing is parsed as HTML.
(() => {
  const languages = ["zh", "en", "ja"];
  const storage = window.siteStorage;
  const readLanguage = () => languages.includes(storage?.getItem("language")) ? storage.getItem("language") : "zh";
  let language = readLanguage();
  const text = (zh, en, ja) => ({ zh, en, ja })[language];
  const CREATORS = { inabakumori: { name: "稲葉曇", handle: "inabakumori" }, nknk: { name: "NKNK", handle: "NKNK_NGRMS" } };
  const PAGE_SIZE = 50;
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
    let search = null;

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
      if (title) document.title = title;
      const description = root.getAttribute(`data-description-${language}`);
      if (description) document.querySelector('meta[name="description"]')?.setAttribute("content", description);
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
      search?.render();
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
      if (event.key === "language" || event.key === null) { language = readLanguage(); applyLanguage(); }
      else if (event.key === "theme") applyTheme();
    });

    search = createSearch();
    document.querySelector(".page-controls")?.removeAttribute("hidden");
    applyLanguage();
    search?.start();
  });

  function createSearch() {
    const form = document.getElementById("post-search-form");
    const core = window.postSearchCore;
    if (!form || !core) return null;
    const input = document.getElementById("post-search-query");
    const creatorSelect = document.getElementById("post-search-creator");
    const yearSelect = document.getElementById("post-search-year");
    const status = document.getElementById("post-search-status");
    const list = document.getElementById("post-search-results");
    const moreButton = document.getElementById("post-search-more");
    const loaded = new Map();
    let manifest = null;
    let results = [];
    let shown = PAGE_SIZE;
    let state = "idle";
    let loadedYears = 0;
    let generation = 0;
    let timer = null;

    const element = (tag, className, content) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    };
    const appendSegments = (parent, value, ranges) => {
      for (const piece of core.segments(value, ranges)) parent.append(piece.mark ? element("mark", "", piece.text) : document.createTextNode(piece.text));
    };
    async function loadManifest() {
      if (manifest) return manifest;
      const response = await fetch("search-index/manifest.json", { cache: "no-cache", credentials: "omit" });
      if (!response.ok) throw new Error("manifest");
      const data = await response.json();
      if (data?.version !== 1 || !Array.isArray(data.years)) throw new Error("manifest");
      manifest = { ...data, years: data.years.filter(entry => /^\d{4}$/u.test(entry.year) && /^posts-\d{4}-[a-f0-9]{12}\.json$/u.test(entry.file)) };
      return manifest;
    }
    async function loadYear(entry) {
      if (loaded.has(entry.year)) return loaded.get(entry.year);
      const response = await fetch(`search-index/${entry.file}`, { credentials: "omit" });
      if (!response.ok) throw new Error("chunk");
      const data = await response.json();
      if (data?.version !== 1 || data.year !== entry.year || !Array.isArray(data.records)) throw new Error("chunk");
      const posts = core.prepare(data.records.filter(record => Array.isArray(record) && /^\d{1,30}$/u.test(record[0]) && typeof record[2] === "string" && typeof record[3] === "string"));
      loaded.set(entry.year, posts);
      return posts;
    }
    const options = () => ({ creator: ["inabakumori", "nknk"].includes(creatorSelect.value) ? creatorSelect.value : "all", year: /^\d{4}$/u.test(yearSelect.value) ? yearSelect.value : "all" });

    async function run() {
      const ticket = ++generation;
      const query = input.value.trim();
      syncAddress(query);
      results = [];
      shown = PAGE_SIZE;
      if (!core.terms(query).length) { state = "idle"; render(); return; }
      state = "loading";
      loadedYears = 0;
      render();
      try {
        const { year } = options();
        const entries = (await loadManifest()).years.filter(entry => year === "all" || entry.year === year);
        const collected = [];
        for (const entry of entries) {
          const posts = await loadYear(entry);
          if (ticket !== generation) return;
          collected.push(...posts);
          loadedYears++;
          results = core.search(collected, query, options());
          render();
        }
        state = "done";
      } catch {
        if (ticket !== generation) return;
        state = "error";
      }
      render();
    }
    function syncAddress(query) {
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        const { creator, year } = options();
        if (creator !== "all") params.set("creator", creator);
        if (year !== "all") params.set("year", year);
        const next = params.toString() ? `?${params}` : "";
        if (window.location.search !== next) window.history.replaceState(null, "", window.location.pathname + next);
      } catch { /* The address is a convenience only. */ }
    }
    const FIELD_LABELS = { text: ["原文", "Original", "原文"], zh: ["中文译文", "Chinese translation", "中国語訳"], en: ["英文译文", "English translation", "英語訳"] };
    function renderResult({ post, matches, fields }) {
      const creator = CREATORS[post.creator];
      const article = element("article", "x-post post-search-result");
      article.dataset.xPostId = post.id;
      const header = element("header", "x-post-header");
      const heading = element("h3", "", `${creator.name} `);
      heading.append(element("span", "", `@${creator.handle}`));
      const time = element("time", "", formatTime(post.publishedAt));
      time.dateTime = post.publishedAt;
      header.append(heading, time);
      const labels = element("p", "post-search-fields");
      labels.append(element("span", "post-search-field-intro", text("匹配：", "Matched in: ", "一致：")));
      for (const field of fields) labels.append(element("span", `post-search-field post-search-field-${field}`, text(...FIELD_LABELS[field])));
      const body = element("p", "x-post-text");
      if (/[\u3040-\u30ff\uff66-\uff9f]/u.test(post.text)) body.lang = "ja";
      body.dir = "auto";
      if (post.text) appendSegments(body, post.text, matches.text);
      else body.textContent = text("这条帖子以媒体为主，请查看原帖。", "This post contains media. View the original post.", "メディアを中心とした投稿です。元の投稿をご覧ください。");
      article.append(header, labels, body);
      for (const field of ["zh", "en"]) {
        if (!matches[field]) continue;
        const line = element("p", "x-post-translation post-search-translation");
        line.lang = field === "zh" ? "zh-CN" : "en";
        line.append(element("span", "post-search-translation-label", `${text(...FIELD_LABELS[field])} · `));
        appendSegments(line, post[field], matches[field]);
        article.append(line);
      }
      const footer = element("footer", "x-post-footer");
      const link = element("a", "x-post-source", text("查看原帖 ↗", "View original ↗", "元の投稿を見る ↗"));
      link.href = `https://x.com/${creator.handle}/status/${post.id}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      footer.append(link);
      article.append(footer);
      return article;
    }
    function render() {
      const total = manifest?.years.filter(entry => options().year === "all" || entry.year === options().year).length ?? 0;
      const message = {
        idle: text("输入关键词搜索原文和中英译文，可用空格分隔多个词。", "Enter words to search the original text and the Chinese/English translations; separate terms with spaces.", "キーワードを入力すると原文と中英訳を検索します。複数語はスペースで区切れます。"),
        loading: text(`正在载入索引（${loadedYears} / ${total || "…"} 个年份）· 已找到 ${results.length} 条`, `Loading the index (${loadedYears} / ${total || "…"} years) · ${results.length} found`, `索引を読み込み中（${loadedYears} / ${total || "…"} 年分）· ${results.length}件`),
        done: results.length ? text(`找到 ${results.length} 条帖子`, `${results.length} post${results.length === 1 ? "" : "s"} found`, `${results.length}件の投稿が見つかりました`) : text("没有找到匹配的帖子。", "No matching posts.", "一致する投稿はありません。"),
        error: text("索引载入失败，请检查网络后重试。", "The index could not be loaded. Check your connection and try again.", "索引を読み込めませんでした。接続を確認してもう一度お試しください。")
      }[state];
      status.textContent = message;
      const nodes = results.slice(0, shown).map(renderResult);
      list.replaceChildren(...nodes);
      moreButton.hidden = results.length <= shown;
      moreButton.textContent = text(`显示更多（剩余 ${results.length - shown} 条）`, `Show more (${results.length - shown} left)`, `さらに表示（残り${results.length - shown}件）`);
    }
    function schedule() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = null; run(); }, 250);
    }
    return {
      render,
      start() {
        const params = new URLSearchParams(window.location.search);
        const query = params.get("q");
        if (query) input.value = query.slice(0, 200);
        if (["inabakumori", "nknk"].includes(params.get("creator"))) creatorSelect.value = params.get("creator");
        const year = params.get("year");
        if (year && [...yearSelect.options].some(option => option.value === year)) yearSelect.value = year;
        form.addEventListener("submit", event => { event.preventDefault(); if (timer !== null) window.clearTimeout(timer); timer = null; run(); });
        input.addEventListener("input", schedule);
        creatorSelect.addEventListener("change", run);
        yearSelect.addEventListener("change", run);
        moreButton.addEventListener("click", () => { shown += PAGE_SIZE; render(); });
        form.hidden = false;
        document.getElementById("post-search-noscript-note")?.setAttribute("hidden", "");
        if (input.value.trim()) run(); else render();
      }
    };
  }
})();
