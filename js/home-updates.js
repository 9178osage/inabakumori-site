(() => {
  function initializeHomeUpdates() {
    const section = document.getElementById("updates");
    if (!section) return;
    const entries = [...section.querySelectorAll(".update-item[data-creator]")];
    const buttons = [...section.querySelectorAll("[data-home-creator]")];
    const more = document.getElementById("home-updates-more");
    const count = document.getElementById("home-updates-count");
    const empty = document.getElementById("home-updates-empty");
    const batch = 6;
    let creator = "all";
    let limit = batch;
    const text = (zh, en, ja) => ({ zh, en, ja })[currentLanguage] || zh;
    const matching = () => entries.filter(entry => creator === "all" || entry.dataset.creator === creator);

    function render() {
      const selected = matching();
      const visible = new Set(selected.slice(0, limit));
      entries.forEach(entry => { entry.hidden = !visible.has(entry); });
      buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.homeCreator === creator)));
      count.hidden = false;
      count.textContent = text(`显示 ${visible.size} / ${selected.length} 条动态`, `Showing ${visible.size} / ${selected.length} updates`, `${selected.length}件中${visible.size}件を表示`);
      empty.hidden = selected.length > 0;
      more.hidden = visible.size >= selected.length;
      const next = Math.min(batch, selected.length - visible.size);
      more.textContent = text(`再显示 ${next} 条动态`, `Show ${next} more updates`, `さらに${next}件を表示`);
    }

    buttons.forEach(button => button.addEventListener("click", () => {
      creator = button.dataset.homeCreator;
      limit = batch;
      render();
    }));
    more.addEventListener("click", () => {
      const focused = document.activeElement === more;
      const previouslyVisible = new Set(entries.filter(entry => !entry.hidden));
      limit += batch;
      render();
      if (more.hidden && focused) {
        const firstNew = entries.find(entry => !entry.hidden && !previouslyVisible.has(entry));
        firstNew?.querySelector("h3 a")?.focus();
      }
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
    section.querySelector(".home-updates-toolbar").hidden = false;
    resume();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeHomeUpdates, { once: true });
  else initializeHomeUpdates();
})();
