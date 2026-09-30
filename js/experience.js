(() => {
  const text = (zh, en, ja) => ({ zh, en, ja })[currentLanguage] || zh;
  const storage = window.siteStorage;
  let favorites;
  try {
    const saved = JSON.parse(storage.getItem("favorite-songs") || "[]");
    favorites = new Set(Array.isArray(saved) ? saved.filter(id => typeof id === "string").slice(0, 1000) : []);
  } catch { favorites = new Set(); }
  let favoritesOnly = false;
  const songId = link => getSongThumbnailUrl(link.href)?.split("/").at(-2) || link.href;
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
        if (sort.value === "popular") return (b.link._songData.viewCount ?? -1) - (a.link._songData.viewCount ?? -1) || a.index - b.index;
        if (sort.value === "title") return a.link.dataset.songTitle.localeCompare(b.link.dataset.songTitle, "ja");
        return a.index - b.index;
      });
      ordered.forEach(({ row }) => list.append(row));
    }
    function syncUrl() {
      const url = new URL(window.location.href);
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
      event.preventDefault();
      input.focus();
      input.scrollIntoView({ block: "center", behavior: reducedMotionQuery?.matches ? "instant" : "smooth" });
    });

    const wall = document.getElementById("floating-wall");
    const wallButton = document.getElementById("wall-mode");
    function updateWallMode() {
      const isStatic = wallStatic || reducedMotionQuery?.matches;
      wall.classList.toggle("wall-static", Boolean(isStatic));
      wallButton.setAttribute("aria-pressed", String(Boolean(isStatic)));
      wallButton.disabled = Boolean(reducedMotionQuery?.matches);
      wallButton.textContent = isStatic ? text("弹幕模式", "Floating messages", "流れる表示") : text("静态阅读", "Read as a list", "一覧で読む");
      if (reducedMotionQuery?.matches) wallButton.textContent = text("静态阅读 · 跟随系统", "Static · reduced motion", "一覧表示 · システム設定");
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
    const saveDraft = () => {
      counter.textContent = `${unicodeLength(message.value)} / 500`;
      try {
        if (!name.value && !message.value) sessionStorage.removeItem("message-draft");
        else sessionStorage.setItem("message-draft", JSON.stringify({ nickname: name.value, content: message.value }));
      } catch { /* Posting remains available. */ }
    };
    name.addEventListener("input", saveDraft);
    message.addEventListener("input", saveDraft);
    window.addEventListener("commentposted", saveDraft);
    saveDraft();

    const nav = document.querySelector(".section-nav");
    if (typeof IntersectionObserver !== "undefined") {
      const hero = document.querySelector(".hero");
      new IntersectionObserver(([entry]) => {
        hero.classList.toggle("out-of-view", !entry.isIntersecting);
      }).observe(hero);
      const sections = [...nav.querySelectorAll("a:not(.back-top)")];
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          sections.forEach(link => {
            if (link.hash === `#${entry.target.id}`) link.setAttribute("aria-current", "location");
            else link.removeAttribute("aria-current");
          });
        }
      }, { rootMargin: "-15% 0px -55% 0px" });
      sections.forEach(link => { const section = document.querySelector(link.hash); if (section) observer.observe(section); });
    }
    const title = document.querySelector(".glitch");
    const labelTitle = () => title.setAttribute("aria-label", title.dataset[currentLanguage]);
    labelTitle();
    window.addEventListener("languagechange", labelTitle);
  });
})();
