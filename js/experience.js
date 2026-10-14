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
  function readFavorites(value) {
    try {
      const saved = JSON.parse(value || "[]");
      return new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string").slice(0, 1000) : []);
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
    }
    function restoreUrl() {
      const params = new URLSearchParams(window.location.search);
      input.value = (params.get("q") || "").slice(0, 200);
      sort.value = ["popular", "title"].includes(params.get("sort")) ? params.get("sort") : "original";
      favoritesOnly = params.get("favorites") === "1";
      favoriteFilter.setAttribute("aria-pressed", String(favoritesOnly));
      sortRows();
      updateTagFilter();
    }
    window.addEventListener("songsfiltered", () => {
      rows.forEach(({ refresh }) => refresh());
      syncUrl();
      status.textContent = "";
    });
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
    sort.addEventListener("change", () => { sortRows(); syncUrl(); });
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
      syncUrl();
      // Favorites are local to each device; share only the public search and sort.
      const url = new URL(window.location.href);
      url.hash = "songs";
      url.searchParams.delete("favorites");
      try {
        await navigator.clipboard.writeText(url.href);
        status.textContent = text("链接已复制", "Link copied", "リンクをコピーしました");
      } catch {
        status.textContent = text("请从地址栏复制链接", "Copy the link from your address bar", "アドレスバーからリンクをコピーしてください");
      }
    });
    window.addEventListener("popstate", restoreUrl);
    window.addEventListener("languagechange", () => rows.forEach(({ refresh }) => refresh()));
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
    reducedMotionQuery?.addEventListener("change", updateWallMode);
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
