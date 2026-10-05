(() => {
  const PAGE_SIZE = 24;
  const THUMB_SIZE = 300;

  const altFor = (id) => {
    const lang = typeof currentLanguage === "string" ? currentLanguage : "zh";
    if (lang === "ja") return `NKNK イラスト ${id}`;
    if (lang === "en") return `NKNK illustration ${id}`;
    return `NKNK 插画 ${id}`;
  };

  const chromeLabel = (kind) => {
    const lang = typeof currentLanguage === "string" ? currentLanguage : "zh";
    const labels = {
      gallery: { zh: "NKNK 插画库", en: "NKNK illustration gallery", ja: "NKNK イラストギャラリー" },
      close: { zh: "关闭", en: "Close", ja: "閉じる" },
      prev: { zh: "上一张", en: "Previous", ja: "前へ" },
      next: { zh: "下一张", en: "Next", ja: "次へ" },
      more: { zh: "加载更多", en: "Load more", ja: "もっと見る" }
    };
    return labels[kind][lang] || labels[kind].zh;
  };

  function initNknkGallery() {
    const items = Array.isArray(window.NKNK_GALLERY) ? window.NKNK_GALLERY : [];
    const section = document.getElementById("artwork");
    const grid = document.getElementById("nknk-gallery");
    const moreBtn = document.getElementById("nknk-gallery-more");
    const lightbox = document.getElementById("nknk-lightbox");
    const image = document.getElementById("nknk-lightbox-image");
    const caption = document.getElementById("nknk-lightbox-caption");
    const closeBtn = document.getElementById("nknk-lightbox-close");
    const prevBtn = document.getElementById("nknk-lightbox-prev");
    const nextBtn = document.getElementById("nknk-lightbox-next");
    if (!grid || !lightbox || !image || !items.length) return;

    let index = 0;
    let visibleCount = 0;
    let mounted = false;
    let open = false;
    let previousFocus = null;
    let touchStartX = 0;
    let touchStartY = 0;
    const preloadCache = new Map();

    const syncChromeLabels = () => {
      grid.setAttribute("aria-label", chromeLabel("gallery"));
      lightbox.setAttribute("aria-label", altFor(items[index]?.id || 1));
      closeBtn?.setAttribute("aria-label", chromeLabel("close"));
      prevBtn?.setAttribute("aria-label", chromeLabel("prev"));
      nextBtn?.setAttribute("aria-label", chromeLabel("next"));
      if (moreBtn) {
        moreBtn.textContent = chromeLabel("more");
        moreBtn.setAttribute("aria-label", chromeLabel("more"));
      }
      grid.querySelectorAll("[data-gallery-id]").forEach((button) => {
        const id = Number(button.dataset.galleryId);
        const img = button.querySelector("img");
        const text = altFor(id);
        button.setAttribute("aria-label", text);
        if (img) img.alt = text;
      });
      if (open) {
        const current = items[index];
        if (current) {
          image.alt = altFor(current.id);
          if (caption) caption.textContent = `${altFor(current.id)} · ${index + 1} / ${items.length}`;
        }
      }
    };

    const updateMoreButton = () => {
      if (!moreBtn) return;
      const remaining = items.length - visibleCount;
      moreBtn.hidden = remaining <= 0;
      moreBtn.disabled = remaining <= 0;
      moreBtn.textContent = chromeLabel("more");
      moreBtn.setAttribute("aria-label", chromeLabel("more"));
    };

    const preloadAdjacent = (center) => {
      for (const offset of [-1, 1]) {
        const item = items[(center + offset + items.length) % items.length];
        if (!item || preloadCache.has(item.full)) continue;
        const pre = new Image();
        pre.decoding = "async";
        pre.src = item.full;
        preloadCache.set(item.full, pre);
      }
    };

    const show = (nextIndex) => {
      index = (nextIndex + items.length) % items.length;
      const item = items[index];
      image.src = item.full;
      image.alt = altFor(item.id);
      if (caption) caption.textContent = `${altFor(item.id)} · ${index + 1} / ${items.length}`;
      lightbox.setAttribute("aria-label", altFor(item.id));
      preloadAdjacent(index);
    };

    const openAt = (nextIndex) => {
      if (open) {
        show(nextIndex);
        return;
      }
      previousFocus = document.activeElement;
      open = true;
      show(nextIndex);
      lightbox.hidden = false;
      document.body.classList.add("nknk-lightbox-open");
      closeBtn?.focus();
    };

    const close = () => {
      if (!open) return;
      open = false;
      lightbox.hidden = true;
      image.removeAttribute("src");
      document.body.classList.remove("nknk-lightbox-open");
      previousFocus?.focus?.({ preventScroll: true });
      previousFocus = null;
    };

    const createItem = (item, itemIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nknk-gallery-item";
      button.dataset.galleryId = String(item.id);
      button.setAttribute("role", "listitem");
      button.setAttribute("aria-label", altFor(item.id));
      const img = document.createElement("img");
      img.src = item.thumb;
      img.alt = altFor(item.id);
      img.loading = "lazy";
      img.decoding = "async";
      img.width = THUMB_SIZE;
      img.height = THUMB_SIZE;
      button.appendChild(img);
      button.addEventListener("click", () => openAt(itemIndex));
      return button;
    };

    const appendBatch = (count = PAGE_SIZE) => {
      const fragment = document.createDocumentFragment();
      const end = Math.min(items.length, visibleCount + count);
      for (let i = visibleCount; i < end; i++) fragment.appendChild(createItem(items[i], i));
      grid.appendChild(fragment);
      visibleCount = end;
      updateMoreButton();
    };

    const mount = () => {
      if (mounted) return;
      mounted = true;
      grid.replaceChildren();
      visibleCount = 0;
      appendBatch(PAGE_SIZE);
      syncChromeLabels();
    };

    moreBtn?.addEventListener("click", () => appendBatch(PAGE_SIZE));
    closeBtn?.addEventListener("click", close);
    prevBtn?.addEventListener("click", () => openAt(index - 1));
    nextBtn?.addEventListener("click", () => openAt(index + 1));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) close();
    });

    document.addEventListener("keydown", (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        openAt(index - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        openAt(index + 1);
      }
    });

    image.addEventListener("touchstart", (event) => {
      if (!open || event.changedTouches.length !== 1) return;
      touchStartX = event.changedTouches[0].clientX;
      touchStartY = event.changedTouches[0].clientY;
    }, { passive: true });
    image.addEventListener("touchend", (event) => {
      if (!open || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) openAt(index + 1);
      else openAt(index - 1);
    }, { passive: true });

    window.addEventListener("languagechange", syncChromeLabels);
    syncChromeLabels();
    updateMoreButton();
    if (moreBtn) moreBtn.hidden = true;

    const target = section || grid;
    if (typeof IntersectionObserver === "undefined") {
      mount();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      mount();
    }, { rootMargin: "400px 0px" });
    observer.observe(target);
  }

  document.addEventListener("DOMContentLoaded", initNknkGallery);
})();
