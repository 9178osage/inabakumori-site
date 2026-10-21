(() => {
  function initializeHomeUpdates() {
    const section = document.getElementById("updates");
    if (!section) return;
    const entries = [...section.querySelectorAll(".update-item[data-creator]")];
    const buttons = [...section.querySelectorAll("[data-home-creator]")];
    const sourceButtons = [...section.querySelectorAll("[data-home-source]")];
    const yearSelect = document.getElementById("home-updates-year");
    const years = new Set(["all", ...entries.map(entry => entry.dataset.year)]);
    const more = document.getElementById("home-updates-more");
    const count = document.getElementById("home-updates-count");
    const empty = document.getElementById("home-updates-empty");
    let creator = "all";
    let source = "all";
    let year = "all";
    const text = (zh, en, ja) => ({ zh, en, ja })[currentLanguage] || zh;
    const matching = () => entries.filter(entry => (creator === "all" || entry.dataset.creator === creator) && (source === "all" || entry.dataset.source === source) && (year === "all" || entry.dataset.year === year));

    function render() {
      const selected = matching();
      const visible = new Set(selected.slice(0, 3));
      entries.forEach(entry => { entry.hidden = !visible.has(entry); });
      buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.homeCreator === creator)));
      sourceButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.homeSource === source)));
      if (yearSelect) yearSelect.value = year;
      count.hidden = false;
      count.textContent = text(`显示 ${visible.size} / ${selected.length} 条动态`, `Showing ${visible.size} / ${selected.length} updates`, `${selected.length}件中${visible.size}件を表示`);
      empty.hidden = selected.length > 0;
      more.hidden = visible.size >= selected.length;
      // With filters the link opens the same filtered list, so say so instead of "all".
      const filtered = creator !== "all" || source !== "all" || year !== "all";
      more.textContent = filtered
        ? text("在动态页查看筛选结果 →", "View filtered results on the updates page →", "更新ページで絞り込み結果を見る →")
        : text("浏览全部作品动态 →", "Browse all work updates →", "作品の更新をすべて見る →");
      // Carry the whitelisted filters to the works list; updates.js validates them again on load.
      const query = [["creator", creator], ["source", source], ["year", year]].filter(([, value]) => value !== "all").map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
      more.setAttribute("href", `updates.html${query ? `?${query}` : ""}#feed-title`);
    }

    buttons.forEach(button => button.addEventListener("click", () => {
      if (!["all", "inabakumori", "nknk"].includes(button.dataset.homeCreator)) return;
      creator = button.dataset.homeCreator;
      render();
    }));
    sourceButtons.forEach(button => button.addEventListener("click", () => {
      if (!["all", "youtube", "pixiv", "campfire"].includes(button.dataset.homeSource)) return;
      source = button.dataset.homeSource;
      render();
    }));
    yearSelect?.addEventListener("change", () => {
      if (!years.has(yearSelect.value)) { yearSelect.value = year; return; }
      year = yearSelect.value;
      render();
    });
    window.addEventListener("languagechange", render);

    function updateStaleness() {
      section.querySelectorAll(".source-status").forEach(source => {
        const checked = Date.parse(source.dataset.checkedAt);
        const warning = source.querySelector(".source-stale");
        if (warning) warning.hidden = Number.isFinite(checked) && Date.now() - checked <= 72 * 60 * 60 * 1000;
      });
    }
    let timer = null;
    function resume() {
      render();
      updateStaleness();
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(updateStaleness, 60_000);
    }
    window.addEventListener("pagehide", () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    });
    window.addEventListener("pageshow", resume);
    section.querySelectorAll(".home-updates-toolbar").forEach(toolbar => { toolbar.hidden = false; });
    resume();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeHomeUpdates, { once: true });
  else initializeHomeUpdates();
})();
