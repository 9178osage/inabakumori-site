(() => {
  // The last nav target whose top has reached the sticky nav (plus a small offset) is the current
  // section; at the very bottom of the page the last target wins even if its top never gets there.
  // Above the first target (the hero) nothing is current.
  function activeSectionLink(links, navBottom, viewportHeight, scrollTop, scrollHeight, find = id => document.getElementById(id)) {
    const targets = links.map(link => [link, find(decodeURIComponent(link.hash.slice(1)))]).filter(([, target]) => target);
    if (!targets.length) return null;
    if (scrollTop > 0 && scrollTop + viewportHeight >= scrollHeight - 2) return targets[targets.length - 1][0];
    let active = null;
    for (const [link, target] of targets) if (target.getBoundingClientRect().top <= navBottom + 24) active = link;
    return active;
  }
  const text = (zh, en, ja) => ({ zh, en, ja })[currentLanguage] || zh;
  const storage = window.siteStorage;
  // Favourites are saved by video ID, so a song whose video link changed keeps its favourites by
  // reading the old ID as the new one. data/song-redirects.json lists the same pairs and a test
  // keeps them in step. A Map avoids Object.hasOwn, which the oldest supported Safari lacks.
  const MOVED_SONG_IDS = new Map([["dmG60q44PJQ", "2A46CwhV4aE"]]);
  const currentSongId = id => MOVED_SONG_IDS.get(id) ?? id;
  function readFavorites(value) {
    try {
      const saved = JSON.parse(value || "[]");
      return new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string").slice(0, 1000).map(currentSongId) : []);
    } catch { return new Set(); }
  }
  let favorites = readFavorites(storage.getItem("favorite-songs"));
  let favoritesOnly = false;
  // Array.prototype.at is Safari/iOS 15.4+. Older iOS threw here, which killed the whole
  // tag filter (search, chips, sort, favorites) with a TypeError, so use plain indexing.
  const songId = link => {
    const parts = getSongThumbnailUrl(link.href)?.split("/");
    return (parts && parts.length > 1 ? parts[parts.length - 2] : "") || link.href;
  };
  window.includeFavoriteSong = link => !favoritesOnly || favorites.has(songId(link));

  document.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("song-list");
    const input = document.getElementById("tag-filter-input");
    const sort = document.getElementById("song-sort");
    const favoriteFilter = document.getElementById("favorites-filter");
    const status = document.getElementById("library-status");
    const importFile = document.getElementById("favorites-import-file");
    // The share hint is written once but has to survive a language switch: keep the
    // renderer beside the element so languagechange can replay it in the new language.
    let renderLibraryStatus = null;
    let shareVersion = 0;
    function clearLibraryStatus() {
      shareVersion++;
      status.textContent = "";
      renderLibraryStatus = null;
    }
    const rows = [...list.querySelectorAll("a")].map((link, index) => {
      const row = document.createElement("div");
      row.className = "song-row";
      link.before(row);
      row.append(link);
      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "song-favorite";
      row.append(favorite);
      const refresh = () => {
        const selected = favorites.has(songId(link));
        favorite.textContent = selected ? "★" : "☆";
        favorite.setAttribute("aria-pressed", String(selected));
        favorite.setAttribute("aria-label", `${selected ? text("取消收藏", "Remove favorite", "お気に入りから削除") : text("收藏", "Save favorite", "お気に入りに追加")} · ${link.dataset.songTitle}`);
        row.hidden = link.hidden;
      };
      favorite.addEventListener("click", () => {
        const id = songId(link);
        if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
        storage.setItem("favorite-songs", JSON.stringify([...favorites]));
        updateTagFilter();
        // A removed favorite may hide the focused row; keep keyboard focus in the controls.
        if (row.hidden) favoriteFilter.focus();
      });
      return { row, link, index, refresh };
    });
    function sortRows() {
      const ordered = [...rows].sort((a, b) => {
        if (sort.value === "popular") return (b.link._songData?.viewCount ?? -1) - (a.link._songData?.viewCount ?? -1) || a.index - b.index;
        if (sort.value === "title") return a.link.dataset.songTitle.localeCompare(b.link.dataset.songTitle, "ja");
        return a.index - b.index;
      });
      ordered.forEach(({ row }) => list.append(row));
    }
    // Hash-only history steps (in-page anchors) keep the query, so they must not overwrite what the
    // visitor is typing before the 150 ms debounce has written it to the URL.
    let appliedSearch = null;
    function syncUrl() {
      const url = new URL(window.location.href);
      // Rebuild the query instead of editing it: leftovers such as ?icons=2 would otherwise ride along
      // into every copied filter link.
      url.search = "";
      const values = { q: input.value.trim().slice(0, 200), sort: sort.value === "original" ? "" : sort.value, favorites: favoritesOnly ? "1" : "" };
      for (const [key, value] of Object.entries(values)) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
      try { window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash); } catch { /* Sandboxed preview. */ }
      appliedSearch = window.location.search;
    }
    function restoreUrl() {
      if (appliedSearch !== null && window.location.search === appliedSearch) return;
      appliedSearch = window.location.search;
      const params = new URLSearchParams(window.location.search);
      input.value = (params.get("q") || "").slice(0, 200);
      sort.value = ["popular", "title"].includes(params.get("sort")) ? params.get("sort") : "original";
      favoritesOnly = params.get("favorites") === "1";
      favoriteFilter.setAttribute("aria-pressed", String(favoritesOnly));
      sortRows();
      updateTagFilter();
    }
    // Language changes re-run the filter without changing its state. Compare both
    // the controls and visible songs so a different query with the same results
    // still retires the old share URL, while a translation keeps the hint.
    let libraryStateKey = "";
    function refreshLibraryState() {
      rows.forEach(({ refresh }) => refresh());
      syncUrl();
      const key = JSON.stringify([input.value.trim().slice(0, 200), sort.value, favoritesOnly,
        rows.map(({ row }) => (row.hidden ? "0" : "1")).join("")]);
      if (key === libraryStateKey) return;
      libraryStateKey = key;
      clearLibraryStatus();
    }
    window.addEventListener("songsfiltered", refreshLibraryState);
    window.addEventListener("storage", event => {
      try { if (event.storageArea !== window.localStorage) return; } catch { return; }
      if (event.key === "favorite-songs" || event.key === null) {
        // Read the event value: the preferences fallback may still cache this tab's last write.
        favorites = readFavorites(event.newValue);
        updateTagFilter();
      }
      if (event.key === "wall-static" || event.key === null) {
        const nextStatic = event.newValue === "true";
        if (nextStatic !== wallStatic) {
          wallStatic = nextStatic;
          updateWallMode();
        }
      }
    });
    sort.addEventListener("change", () => { sortRows(); updateTagFilter(); });
    favoriteFilter.addEventListener("click", () => {
      favoritesOnly = !favoritesOnly;
      favoriteFilter.setAttribute("aria-pressed", String(favoritesOnly));
      updateTagFilter();
    });
    document.getElementById("tag-filter-clear").addEventListener("click", () => {
      favoritesOnly = false;
      favoriteFilter.setAttribute("aria-pressed", "false");
      updateTagFilter();
    });
    document.getElementById("share-search").addEventListener("click", async () => {
      refreshLibraryState();
      clearLibraryStatus();
      const version = shareVersion;
      // Favorites are local to each device; share only the public search and sort.
      const url = new URL(window.location.href);
      url.hash = "songs";
      url.searchParams.delete("favorites");
      const sharedUrl = url.href;
      let copied = false;
      try {
        await navigator.clipboard.writeText(sharedUrl);
        copied = true;
      } catch { /* Show a manually copyable public URL when clipboard access fails. */ }
      // A pending permission prompt can outlive a filter change or another share.
      if (version !== shareVersion) return;
      renderLibraryStatus = copied
        ? () => text("链接已复制", "Link copied", "リンクをコピーしました")
        : () => `${text("无法自动复制，请复制此链接：", "Could not copy automatically. Copy this link: ", "自動コピーできませんでした。このリンクをコピーしてください：")}${sharedUrl}`;
      status.textContent = renderLibraryStatus();
    });
    document.getElementById("favorites-export")?.addEventListener("click", () => {
      clearLibraryStatus();
      try {
        const valid = [...favorites].filter(id => /^[A-Za-z0-9_-]{11}$/u.test(id));
        const skipped = favorites.size - valid.length;
        const payload = JSON.stringify({ type: "inabakumori-favorites", version: 1, songs: valid }, null, 2);
        const objectUrl = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = "inabakumori-favorites.json";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        renderLibraryStatus = () => skipped
          ? text(`收藏已导出，忽略了 ${skipped} 条无效记录。`, `Favorites exported; ${skipped} invalid records skipped.`, `お気に入りを書き出しました。無効な記録${skipped}件を除外しました。`)
          : text("收藏已导出。", "Favorites exported.", "お気に入りを書き出しました。");
      } catch {
        renderLibraryStatus = () => text("导出失败，请重试。", "Export failed. Please try again.", "書き出せませんでした。もう一度お試しください。");
      }
      status.textContent = renderLibraryStatus();
    });
    document.getElementById("favorites-import")?.addEventListener("click", () => importFile?.click());
    importFile?.addEventListener("change", async () => {
      const file = importFile.files?.[0];
      importFile.value = "";
      if (!file) return;
      clearLibraryStatus();
      const version = shareVersion;
      try {
        if (file.size > 100_000) throw new Error("File too large");
        const data = JSON.parse(await file.text());
        if (version !== shareVersion) return;
        if (data?.type !== "inabakumori-favorites" || data.version !== 1 || !Array.isArray(data.songs) || data.songs.length > 1000 || !data.songs.every(id => typeof id === "string" && /^[A-Za-z0-9_-]{11}$/u.test(id))) throw new Error("Invalid favorites file");
        const imported = data.songs.map(currentSongId);
        const merged = new Set([...favorites, ...imported]);
        if (merged.size > 1000) throw new Error("Too many favorites");
        const added = merged.size - favorites.size;
        favorites = merged;
        storage.setItem("favorite-songs", JSON.stringify([...favorites]));
        let persisted = false;
        try { persisted = window.localStorage.getItem("favorite-songs") === JSON.stringify([...favorites]); } catch { /* Storage is unavailable. */ }
        const known = new Set(rows.map(({ link }) => songId(link)));
        const unknown = [...new Set(imported)].filter(id => !known.has(id)).length;
        updateTagFilter();
        renderLibraryStatus = () => {
          const result = text(`已合并收藏，新增 ${added} 首。`, `Favorites merged; ${added} added.`, `お気に入りを統合し、${added}曲を追加しました。`);
          const missing = unknown ? text(`其中 ${unknown} 首暂不在本站歌曲表中，已保留。`, ` ${unknown} imported ${unknown === 1 ? "song is" : "songs are"} not in the current catalog and ${unknown === 1 ? "has" : "have"} been kept.`, `現在の楽曲一覧にない${unknown}曲も保持しています。`) : "";
          const warning = persisted ? "" : text("浏览器无法持久保存，请保留备份。", " Browser storage is unavailable; keep your backup.", "ブラウザに保存できないため、バックアップを保管してください。");
          return result + missing + warning;
        };
      } catch {
        if (version !== shareVersion) return;
        renderLibraryStatus = () => text("导入失败：请选择本站导出的收藏文件。", "Import failed: choose a favorites file exported by this site.", "読み込めませんでした。このサイトから書き出したファイルを選んでください。");
      }
      status.textContent = renderLibraryStatus();
    });
    window.addEventListener("popstate", restoreUrl);
    window.addEventListener("languagechange", () => {
      rows.forEach(({ refresh }) => refresh());
      if (renderLibraryStatus) status.textContent = renderLibraryStatus();
    });
    restoreUrl();
    document.addEventListener("keydown", event => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.target.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (document.getElementById("auth-modal").classList.contains("open")) return;
      // The lightbox and the easter egg own the page while they are open: focusing the search box
      // would scroll the inert background behind them.
      const lightbox = document.getElementById("nknk-lightbox");
      if (lightbox && !lightbox.hidden) return;
      if (document.getElementById("easter-egg-overlay")?.classList.contains("show")) return;
      event.preventDefault();
      const expand = document.getElementById("mobile-songs-expand");
      if (expand && !expand.hidden) expand.click();
      input.focus();
      input.scrollIntoView({ block: "center", behavior: reducedMotionQuery?.matches ? "instant" : "smooth" });
    });

    const wall = document.getElementById("floating-wall");
    const wallButton = document.getElementById("wall-mode");
    function updateWallMode() {
      const isStatic = wallStatic || reducedMotionQuery?.matches;
      wall.classList.toggle("wall-static", Boolean(isStatic));
      // The label names the mode the button switches to, so it is an action button, not a toggle (no aria-pressed).
      wallButton.disabled = Boolean(reducedMotionQuery?.matches);
      wallButton.textContent = isStatic ? text("弹幕模式", "Floating messages", "流れる表示") : text("静态阅读", "Read as a list", "一覧で読む");
      if (reducedMotionQuery?.matches) wallButton.textContent = text("静态阅读 · 跟随系统", "Read as a list · reduced motion", "一覧で読む（システム設定に従う）");
      document.querySelectorAll(".floating-message").forEach(element => element.refreshLayout());
    }
    wallStatic = storage.getItem("wall-static") === "true";
    wallButton.addEventListener("click", () => {
      wallStatic = !wallStatic;
      storage.setItem("wall-static", String(wallStatic));
      updateWallMode();
    });
    if (reducedMotionQuery?.addEventListener) reducedMotionQuery.addEventListener("change", updateWallMode);
    else reducedMotionQuery?.addListener?.(updateWallMode);
    window.addEventListener("languagechange", updateWallMode);
    updateWallMode();

    const name = document.getElementById("message-name");
    const message = document.getElementById("message-input");
    const counter = document.getElementById("message-counter");
    // Drafts stay in this tab's session and are removed on successful posting.
    try {
      const draft = JSON.parse(sessionStorage.getItem("message-draft") || "null");
      if (draft && typeof draft.nickname === "string" && typeof draft.content === "string") {
        name.value = draft.nickname;
        message.value = draft.content;
        enforceCommentFieldLimits(name, message);
      }
    } catch { /* Session storage can be unavailable. */ }
    // Idempotent: the counter is recomputed and storage is written only when the draft actually changed,
    // so compositionend followed by input (Chrome) and compositionend alone (Safari) end in the same state.
    let lastDraft = null;
    const saveDraft = () => {
      counter.textContent = `${unicodeLength(message.value)} / 500`;
      const draft = !name.value && !message.value ? "" : JSON.stringify({ nickname: name.value, content: message.value });
      if (draft === lastDraft) return;
      lastDraft = draft;
      try {
        if (!draft) sessionStorage.removeItem("message-draft");
        else sessionStorage.setItem("message-draft", draft);
      } catch { /* Posting remains available. */ }
    };
    // Safari may not fire input after compositionend: apply the (idempotent) length limit, then refresh
    // the counter and draft so they never show the pre-trim text.
    const afterComposition = () => {
      enforceCommentFieldLimits(name, message);
      saveDraft();
    };
    name.addEventListener("input", saveDraft);
    message.addEventListener("input", saveDraft);
    name.addEventListener("compositionend", afterComposition);
    message.addEventListener("compositionend", afterComposition);
    window.addEventListener("commentposted", saveDraft);
    saveDraft();

    const nav = document.querySelector(".section-nav");
    if (typeof IntersectionObserver !== "undefined") {
      const hero = document.querySelector(".hero");
      new IntersectionObserver(entries => {
        // Several entries can be queued for one target during a fast scroll; the last one is current.
        const out = !entries[entries.length - 1].isIntersecting;
        hero.classList.toggle("out-of-view", out);
        // Class on the controls themselves (not body:has(...)) so toggling restyles only them (perf P6).
        document.querySelector(".site-controls")?.classList.toggle("hero-out", out);
      }).observe(hero);
    }
    // Active section comes from the scroll position on every (rAF-throttled) scroll/resize, not from
    // IntersectionObserver deltas: those only fire on threshold crossings and could leave a stale
    // highlight (e.g. songs -> up into artwork -> back down kept 插画).
    if (nav) {
      const links = [...nav.querySelectorAll("a:not(.back-top)")];
      let frame = 0;
      const update = () => {
        frame = 0;
        // Anchor jumps land at scroll-padding-top (110px desktop / 140px mobile), which can sit below the
        // nav bottom; use whichever is lower so a clicked section is the highlighted one.
        const padding = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const active = activeSectionLink(links, Math.max(nav.getBoundingClientRect().bottom, padding), window.innerHeight,
          window.scrollY || document.documentElement.scrollTop, document.documentElement.scrollHeight);
        links.forEach(link => {
          if (link === active) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });        // Narrow screens scroll the nav strip sideways (long ja/en labels); keep the active link in view.
        if (active && nav.scrollWidth > nav.clientWidth + 1) {
          const navBox = nav.getBoundingClientRect(), linkBox = active.getBoundingClientRect();
          const edge = 12;
          if (linkBox.right > navBox.right - edge) nav.scrollLeft += linkBox.right - navBox.right + edge;
          else if (linkBox.left < navBox.left + edge) nav.scrollLeft -= navBox.left + edge - linkBox.left;
        }
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
      window.addEventListener("load", schedule);
      document.fonts?.ready?.then(schedule);
      update();
    }
    const title = document.querySelector(".glitch");
    const labelTitle = () => title.setAttribute("aria-label", title.dataset[currentLanguage]);
    labelTitle();
    window.addEventListener("languagechange", labelTitle);
  });
})();
