// Homepage X post snapshot: filter the pre-rendered posts by creator.
// Only toggles `hidden`, attributes and textContent; never builds markup from strings.
(() => {
  const ARCHIVE_PAGES = { all: "updates.html", inabakumori: "updates-inabakumori.html", nknk: "updates-nknk.html" };
  function initializeXPostsHome() {
    const section = document.querySelector("[data-x-posts-home]");
    if (!section) return;
    const posts = [...section.querySelectorAll(".x-post[data-creator]")];
    const buttons = [...section.querySelectorAll("[data-x-home-creator]")];
    const filters = section.querySelector(".x-home-filters");
    const count = section.querySelector("[data-x-home-count]");
    const archiveLink = section.querySelector("[data-x-archive-link]");
    if (!filters || !count || !posts.length) return;
    let creator = "all";
    const language = () => (typeof currentLanguage === "string" ? currentLanguage : document.documentElement.lang || "zh");
    const text = (zh, en, ja) => {
      const value = language();
      return value.startsWith("en") ? en : value.startsWith("ja") ? ja : zh;
    };
    const total = name => {
      const key = name === "all" ? "xTotal" : name === "inabakumori" ? "xTotalInabakumori" : "xTotalNknk";
      const value = Number.parseInt(section.dataset[key] ?? "", 10);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    };

    function render() {
      let visible = 0;
      posts.forEach(post => {
        const shown = creator === "all" || post.dataset.creator === creator;
        post.hidden = !shown;
        if (shown) visible++;
      });
      buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.xHomeCreator === creator)));
      const all = total(creator);
      count.hidden = false;
      count.textContent = text(`显示最近 ${visible} 条 · 已收录 ${all} 条`, `Showing the latest ${visible} · ${all} collected`, `最新${visible}件を表示 · 収録${all}件`);
      if (archiveLink) {
        archiveLink.setAttribute("href", ARCHIVE_PAGES[creator]);
        const label = creator === "all"
          ? text("在本站浏览已收录的全部帖子 →", "Browse all collected posts on this site →", "サイト内で収録済みの投稿をすべて見る →")
          : text(`在本站浏览 ${creator === "nknk" ? "NKNK" : "稲葉曇"} 的全部帖子 →`, `Browse all posts by ${creator === "nknk" ? "NKNK" : "Inabakumori"} →`, `${creator === "nknk" ? "NKNK" : "稲葉曇"}の投稿をすべて見る →`);
        archiveLink.textContent = label;
      }
    }

    buttons.forEach(button => button.addEventListener("click", () => {
      const next = button.dataset.xHomeCreator;
      if (!Object.hasOwn(ARCHIVE_PAGES, next)) return;
      creator = next;
      render();
    }));
    // script.js fires languagechange after rewriting [data-zh] text; re-apply the filter-specific labels.
    window.addEventListener("languagechange", render);
    filters.hidden = false;
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeXPostsHome, { once: true });
  else initializeXPostsHome();
})();
