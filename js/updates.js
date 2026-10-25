(() => {
  function initializeUpdates() {
    const languages = ["zh", "en", "ja"];
    const storage = window.siteStorage;
    const readLanguage = () => languages.includes(storage.getItem("language")) ? storage.getItem("language") : "zh";
    let language = readLanguage();
    let filter = "all";
    // Filters linked from the homepage (?creator=&source=&year=). Unknown values are ignored.
    let source = "all";
    let year = "all";
    const linked = {};
    for (const pair of String(window.location?.search || "").replace(/^\?/u, "").split("&")) {
      const separator = pair.indexOf("=");
      const key = separator < 0 ? pair : pair.slice(0, separator);
      const value = separator < 0 ? "" : pair.slice(separator + 1);
      if (!["creator", "source", "year"].includes(key) || key in linked) continue;
      // Only the first occurrence of a key counts, even when its value is malformed.
      linked[key] = "";
      try { linked[key] = decodeURIComponent(value.replace(/\+/gu, " ")); }
      catch { /* Ignore this malformed value while keeping the other filters. */ }
    }
    const knownYears = new Set([...document.querySelectorAll(".update-item[data-year]")].map(entry => entry.dataset.year));
    if (["inabakumori", "nknk"].includes(linked.creator)) filter = linked.creator;
    if (["youtube", "pixiv", "campfire"].includes(linked.source)) source = linked.source;
    if (/^\d{4}$/u.test(linked.year || "") && knownYears.has(linked.year)) year = linked.year;
    const langButton = document.getElementById("updates-lang-btn");
    const themeButton = document.getElementById("updates-theme-btn");
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    const text = (zh, en, ja) => ({ zh, en, ja })[language];

    function applyFilter() {
      // Archive page 2+ links to the works list on page 1 instead of repeating it; no count or empty notice there.
      if (document.querySelector("[data-works-list-link]")) return;
      const entries = [...document.querySelectorAll(".update-item[data-creator]")];
      let count = 0;
      entries.forEach(entry => {
        const shown = (filter === "all" || entry.dataset.creator === filter) && (source === "all" || entry.dataset.source === source) && (year === "all" || entry.dataset.year === year);
        entry.hidden = !shown;
        if (shown) count++;
      });
      document.querySelectorAll("[data-filter]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
      });
      const result = document.getElementById("updates-count");
      if (result) {
        result.hidden = false;
        const sourceLabel = { youtube: "YouTube", pixiv: "pixiv", campfire: "CAMPFIRE" }[source];
        const scope = [sourceLabel, year === "all" ? "" : year].filter(Boolean).join(" · ");
        result.textContent = (scope ? `${scope} · ` : "") + text(`已收录 ${count} 条 · 点击标题查看原始发布`, `${count} collected · Open a title for the original post`, `${count}件収録 · タイトルから元の投稿へ`);
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

    const dateFormatters = new Map();
    function applyLanguage() {
      document.documentElement.lang = { zh: "zh-CN", en: "en", ja: "ja" }[language];
      // Creator archives and page 2+ name their slice; mirrors xPostsPageTitle in tools/render-x-posts.mjs.
      const archiveCreator = ["inabakumori", "nknk"].includes(document.documentElement.dataset?.archiveCreator) ? document.documentElement.dataset.archiveCreator : "all";
      const archivePage = /^[1-9]\d{0,4}$/u.test(document.documentElement.dataset?.archivePage || "") ? Number(document.documentElement.dataset.archivePage) : 1;
      const slice = [
        archiveCreator === "inabakumori" ? text("稲葉曇的 X 帖子", "Inabakumori’s X posts", "稲葉曇のX投稿") : archiveCreator === "nknk" ? text("NKNK 的 X 帖子", "NKNK’s X posts", "NKNKのX投稿") : "",
        archivePage > 1 ? text(`第 ${archivePage} 页`, `Page ${archivePage}`, `${archivePage}ページ目`) : ""
      ].filter(Boolean).join(" · ");
      document.title = [slice, text("最新动态 · 稲葉曇与 NKNK", "Latest updates · Inabakumori & NKNK", "最新情報 · 稲葉曇・ぬくぬくにぎりめし")].filter(Boolean).join(" · ");
      const description = document.querySelector('meta[name="description"]');
      const baseDescription = text("稲葉曇与ぬくぬくにぎりめし（NKNK）的作品动态，附官方来源与核对时间。", "New work from Inabakumori and Nukunuku Nigirimeshi (NKNK), with official sources and check times.", "稲葉曇さんとぬくぬくにぎりめしさんの作品情報。公式の取得元と確認日時を掲載。");
      const pageDescription = slice ? `${slice}${language === "en" ? ": " : "："}${baseDescription}` : baseDescription;
      if (description) description.content = pageDescription;
      document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title);
      document.querySelector('meta[property="og:description"]')?.setAttribute("content", pageDescription);
      document.querySelectorAll("[data-zh][data-en][data-ja]").forEach(element => {
        element.textContent = element.dataset[language];
      });
      document.querySelectorAll("[data-aria-zh]").forEach(element => {
        element.setAttribute("aria-label", element.dataset[`aria${language[0].toUpperCase()}${language.slice(1)}`] || element.dataset.ariaZh);
      });
      document.querySelectorAll("time[data-local-time]").forEach(element => {
        const date = new Date(element.dateTime);
        if (!Number.isFinite(date.getTime())) return;
        let formatter = dateFormatters.get(language);
        if (!formatter) {
          formatter = new Intl.DateTimeFormat({ zh: "zh-CN", en: "en-US", ja: "ja-JP" }[language], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
          dateFormatters.set(language, formatter);
        }
        const formatted = formatter.format(date) + " JST";
        if (element.textContent !== formatted) element.textContent = formatted;
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
      if (!["all", "inabakumori", "nknk"].includes(button.dataset.filter)) return;
      filter = button.dataset.filter;
      // Choosing a creator here starts over from all sources and years.
      source = "all";
      year = "all";
      // Keep only the chosen creator in the address (none for "all") so a reload restores it,
      // while the linked source/year are dropped. The page's own path and hash are preserved.
      try {
        const query = filter === "all" ? "" : "?creator=" + encodeURIComponent(filter);
        if ((window.location?.search || "") !== query) window.history?.replaceState?.(null, "", window.location.pathname + query + window.location.hash);
      } catch { /* history unavailable: in-memory state still applies */ }
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
        const stale = !Number.isFinite(stamp) || Date.now() - stamp > 72 * 60 * 60 * 1000;
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
    initReadingPosition(storage, () => language);
    document.querySelector(".page-controls")?.removeAttribute("hidden");
    if (!document.querySelector("[data-works-list-link]")) document.querySelector(".updates-filters")?.removeAttribute("hidden");
  }
  // Reading position and "new since last visit" for the X archive pages. Stored only in this
  // browser (siteStorage → localStorage, or memory when storage is blocked); never sent anywhere.
  const READING_KEY = "xArchiveReading";
  const SEEN_KEY = "xArchiveSeen";
  const BADGE_WINDOW = 30 * 60 * 1000;
  const ARCHIVE_PAGE = /^updates(?:-(?:inabakumori|nknk))?(?:-page-[1-9]\d{0,4})?\.html$/u;
  const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
  const validMark = mark => Boolean(mark) && typeof mark === "object" && typeof mark.at === "string" && STAMP.test(mark.at) && typeof mark.id === "string" && /^\d{1,30}$/u.test(mark.id);
  const compareMarks = (a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function readRecord(storage, key) {
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch { return null; }
  }
  function writeRecord(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* Storage blocked: the feature quietly does nothing. */ }
  }
  // The baseline stays fixed for a short while so a reload within the same visit keeps its badges.
  function nextSeenState(previous, newest, now) {
    const through = validMark(previous?.through) ? previous.through : null;
    const recent = through && Number.isFinite(previous.since) && now - previous.since >= 0 && now - previous.since < BADGE_WINDOW;
    const baseline = recent ? (validMark(previous.baseline) ? previous.baseline : null) : through;
    const latest = !through || (newest && compareMarks(newest, through) > 0) ? newest : through;
    return { baseline, record: { through: latest, baseline, since: recent ? previous.since : now } };
  }
  function pageLabel(page) {
    const creator = /^updates-(inabakumori|nknk)/u.exec(page)?.[1];
    const number = Number(/-page-(\d+)\.html$/u.exec(page)?.[1] || 1);
    const who = creator === "inabakumori" ? ["稲葉曇 · ", "Inabakumori · ", "稲葉曇 · "] : creator === "nknk" ? ["NKNK · ", "NKNK · ", "NKNK · "] : ["", "", ""];
    return { zh: `${who[0]}第 ${number} 页`, en: `${who[1]}page ${number}`, ja: `${who[2]}${number}ページ目` };
  }
  function initReadingPosition(storage, currentLanguage) {
    const feed = document.querySelector(".x-posts-archive .x-posts-feed");
    if (!feed || !storage) return;
    const page = String(window.location?.pathname || "").split("/").pop() || "updates.html";
    if (!ARCHIVE_PAGE.test(page)) return;
    const articles = [...feed.querySelectorAll("article.x-post[data-x-post-id]")];
    const markOf = article => ({ at: article.querySelector("time[datetime]")?.getAttribute("datetime") || "", id: article.dataset.xPostId || "" });
    const tri = (tag, className, values) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      node.dataset.zh = values.zh; node.dataset.en = values.en; node.dataset.ja = values.ja;
      node.textContent = values[currentLanguage()];
      return node;
    };
    // New-post badges compare against the newest post this browser had seen before.
    const meta = document.querySelector('meta[name="x-posts-newest"]')?.getAttribute("content")?.split(" ") || [];
    const newest = validMark({ at: meta[0], id: meta[1] }) ? { at: meta[0], id: meta[1] } : null;
    const { baseline, record } = nextSeenState(readRecord(storage, SEEN_KEY), newest, Date.now());
    if (baseline) {
      for (const article of articles) {
        const mark = markOf(article);
        if (!validMark(mark) || compareMarks(mark, baseline) <= 0) continue;
        article.dataset.newPost = "";
        article.querySelector(".x-post-header h3")?.append(tri("span", "x-post-new", { zh: "新", en: "NEW", ja: "新着" }));
      }
    }
    if (newest) writeRecord(storage, SEEN_KEY, record);
    const scrollToPost = () => {
      const id = /^#x-post-(\d{1,30})$/u.exec(window.location?.hash || "")?.[1];
      const target = id && articles.find(article => article.dataset.xPostId === id);
      if (!target) return false;
      target.scrollIntoView({ block: "start" });
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      return true;
    };
    // Continue-reading link, unless this visit already opened that exact spot.
    const saved = readRecord(storage, READING_KEY);
    const savedValid = saved && typeof saved.page === "string" && ARCHIVE_PAGE.test(saved.page) && typeof saved.id === "string" && /^\d{1,30}$/u.test(saved.id);
    const arrivedAtSaved = savedValid && saved.page === page && (window.location.hash === `#x-post-${saved.id}` || articles[0]?.dataset.xPostId === saved.id);
    if (savedValid && !arrivedAtSaved) {
      const label = pageLabel(saved.page);
      const box = document.createElement("p");
      box.className = "x-reading-resume";
      box.setAttribute("role", "note");
      const link = tri("a", "", { zh: `继续上次阅读 →（${label.zh}）`, en: `Continue where you left off → (${label.en})`, ja: `前回の続きから読む →（${label.ja}）` });
      link.href = `${saved.page}#x-post-${saved.id}`;
      const dismiss = tri("button", "", { zh: "不用了", en: "Dismiss", ja: "閉じる" });
      dismiss.type = "button";
      dismiss.addEventListener("click", () => { box.remove(); writeRecord(storage, READING_KEY, null); });
      box.append(link, dismiss);
      feed.before(box);
    }
    // Save the first post still on screen, but only once the reader has actually scrolled into
    // the list, so simply arriving at the top never overwrites the previous position.
    let timer = null;
    const save = () => {
      timer = null;
      if ((window.scrollY || 0) < 300) return;
      const current = articles.find(article => article.getBoundingClientRect().bottom > 80);
      if (current) writeRecord(storage, READING_KEY, { page, id: current.dataset.xPostId, savedAt: new Date().toISOString() });
    };
    window.addEventListener("scroll", () => { if (timer === null) timer = window.setTimeout(save, 400); }, { passive: true });
    window.addEventListener("pagehide", save);
    window.addEventListener("hashchange", scrollToPost);
    scrollToPost();
  }
  window.xArchiveReading = Object.freeze({ nextSeenState, compareMarks, validMark, pageLabel, readRecord });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeUpdates, { once: true });
  else initializeUpdates();
})();
