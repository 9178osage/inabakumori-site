(() => {
  const SPEED_PX_PER_SEC = 28;
  const DRAG_THRESHOLD = 6;
  const ROW_COUNT = 2;

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
      next: { zh: "下一张", en: "Next", ja: "次へ" }
    };
    return labels[kind][lang] || labels[kind].zh;
  };

  const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  function initNknkGallery() {
    const items = Array.isArray(window.NKNK_GALLERY) ? window.NKNK_GALLERY : [];
    const section = document.getElementById("artwork");
    const root = document.getElementById("nknk-gallery");
    const lightbox = document.getElementById("nknk-lightbox");
    const image = document.getElementById("nknk-lightbox-image");
    const caption = document.getElementById("nknk-lightbox-caption");
    const closeBtn = document.getElementById("nknk-lightbox-close");
    const prevBtn = document.getElementById("nknk-lightbox-prev");
    const nextBtn = document.getElementById("nknk-lightbox-next");
    if (!root || !lightbox || !image || !items.length) return;

    let lightboxIndex = 0;
    let lightboxOpen = false;
    let previousFocus = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let mounted = false;
    let sectionVisible = false;
    let pageVisible = !document.hidden;
    let reduced = prefersReducedMotion();
    const preloadCache = new Map();
    const rows = [];

    const syncChromeLabels = () => {
      root.setAttribute("aria-label", chromeLabel("gallery"));
      lightbox.setAttribute("aria-label", altFor(items[lightboxIndex]?.id || 1));
      closeBtn?.setAttribute("aria-label", chromeLabel("close"));
      prevBtn?.setAttribute("aria-label", chromeLabel("prev"));
      nextBtn?.setAttribute("aria-label", chromeLabel("next"));
      root.querySelectorAll(".nknk-marquee-item[data-gallery-id]:not([aria-hidden='true'])").forEach((button) => {
        const id = Number(button.dataset.galleryId);
        const img = button.querySelector("img");
        const text = altFor(id);
        button.setAttribute("aria-label", text);
        if (img) img.alt = text;
      });
      if (lightboxOpen) {
        const current = items[lightboxIndex];
        if (current) {
          image.alt = altFor(current.id);
          if (caption) caption.textContent = `${altFor(current.id)} · ${lightboxIndex + 1} / ${items.length}`;
        }
      }
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

    const showLightbox = (nextIndex) => {
      lightboxIndex = (nextIndex + items.length) % items.length;
      const item = items[lightboxIndex];
      image.src = item.full;
      image.alt = altFor(item.id);
      if (caption) caption.textContent = `${altFor(item.id)} · ${lightboxIndex + 1} / ${items.length}`;
      lightbox.setAttribute("aria-label", altFor(item.id));
      preloadAdjacent(lightboxIndex);
    };

    const openAt = (nextIndex) => {
      if (lightboxOpen) {
        showLightbox(nextIndex);
        return;
      }
      previousFocus = document.activeElement;
      lightboxOpen = true;
      showLightbox(nextIndex);
      lightbox.hidden = false;
      document.body.classList.add("nknk-lightbox-open");
      syncPauseState();
      closeBtn?.focus();
    };

    const closeLightbox = () => {
      if (!lightboxOpen) return;
      lightboxOpen = false;
      lightbox.hidden = true;
      image.removeAttribute("src");
      document.body.classList.remove("nknk-lightbox-open");
      previousFocus?.focus?.({ preventScroll: true });
      previousFocus = null;
      syncPauseState();
    };

    const createButton = (item, absoluteIndex, { clone = false } = {}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nknk-marquee-item";
      button.dataset.galleryId = String(item.id);
      button.dataset.galleryIndex = String(absoluteIndex);
      if (clone) {
        button.setAttribute("aria-hidden", "true");
        button.tabIndex = -1;
      } else {
        button.setAttribute("aria-label", altFor(item.id));
      }
      const img = document.createElement("img");
      img.src = item.thumb;
      img.alt = clone ? "" : altFor(item.id);
      img.decoding = "async";
      img.loading = "eager";
      img.draggable = false;
      button.appendChild(img);
      return button;
    };

    const splitRows = () => {
      const buckets = Array.from({ length: ROW_COUNT }, () => []);
      items.forEach((item, index) => buckets[index % ROW_COUNT].push({ item, index }));
      return buckets;
    };

    const measureLoopWidth = (track) => {
      const kids = [...track.children];
      if (kids.length < 2) return track.scrollWidth / 2;
      const half = kids.length / 2;
      let width = 0;
      for (let i = 0; i < half; i++) width += kids[i].offsetWidth;
      const style = getComputedStyle(track);
      const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
      width += gap * Math.max(0, half - 1);
      return width || track.scrollWidth / 2;
    };

    const bindRowInteractions = (row) => {
      const { viewport, track } = row;
      let pointerId = null;
      let startX = 0;
      let startOffset = 0;
      let moved = false;
      let activeButton = null;

      const onPointerDown = (event) => {
        if (event.button != null && event.button !== 0) return;
        if (reduced) return;
        pointerId = event.pointerId;
        startX = event.clientX;
        startOffset = row.offset;
        moved = false;
        activeButton = event.target.closest?.(".nknk-marquee-item") || null;
        row.paused = true;
        row.dragging = true;
        viewport.classList.add("is-dragging");
        try { viewport.setPointerCapture(pointerId); } catch { /* ignore */ }
      };

      const onPointerMove = (event) => {
        if (pointerId == null || event.pointerId !== pointerId) return;
        const dx = event.clientX - startX;
        if (Math.abs(dx) >= DRAG_THRESHOLD) moved = true;
        if (!moved) return;
        event.preventDefault();
        row.offset = startOffset + (row.direction > 0 ? dx : -dx);
        wrapOffset(row);
        applyTransform(row);
      };

      const onPointerUp = (event) => {
        if (pointerId == null || event.pointerId !== pointerId) return;
        pointerId = null;
        row.dragging = false;
        viewport.classList.remove("is-dragging");
        try { viewport.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
        const shouldClick = !moved && activeButton;
        activeButton = null;
        if (shouldClick) {
          const absoluteIndex = Number(shouldClick.dataset.galleryIndex);
          if (Number.isFinite(absoluteIndex)) openAt(absoluteIndex);
        }
        syncPauseState();
      };

      viewport.addEventListener("pointerdown", onPointerDown);
      viewport.addEventListener("pointermove", onPointerMove);
      viewport.addEventListener("pointerup", onPointerUp);
      viewport.addEventListener("pointercancel", onPointerUp);
      viewport.addEventListener("pointerleave", () => {
        if (pointerId != null) return;
        row.hover = false;
        syncPauseState();
      });
      viewport.addEventListener("pointerenter", () => {
        row.hover = true;
        syncPauseState();
      });
      viewport.addEventListener("focusin", () => {
        row.focus = true;
        syncPauseState();
      });
      viewport.addEventListener("focusout", () => {
        // Defer so focus moving within the row does not briefly resume.
        queueMicrotask(() => {
          row.focus = viewport.contains(document.activeElement);
          syncPauseState();
        });
      });

      // Reduced-motion / fallback: native click opens lightbox.
      track.addEventListener("click", (event) => {
        if (!reduced) {
          // Non-reduced clicks are handled on pointerup to distinguish drag.
          event.preventDefault();
          return;
        }
        const button = event.target.closest?.(".nknk-marquee-item");
        if (!button) return;
        const absoluteIndex = Number(button.dataset.galleryIndex);
        if (Number.isFinite(absoluteIndex)) openAt(absoluteIndex);
      });
    };

    const applyTransform = (row) => {
      trackTransform(row.track, row.direction < 0 ? -row.offset : row.offset);
    };

    const trackTransform = (track, x) => {
      track.style.transform = `translate3d(${x}px, 0, 0)`;
    };

    const wrapOffset = (row) => {
      if (!row.loopWidth) return;
      row.offset %= row.loopWidth;
      if (row.offset < 0) row.offset += row.loopWidth;
    };

    const syncPauseState = () => {
      for (const row of rows) {
        row.paused = reduced || !sectionVisible || !pageVisible || row.hover || row.focus || row.dragging || lightboxOpen;
      }
    };

    let rafId = 0;
    let lastTs = 0;
    const tick = (ts) => {
      rafId = requestAnimationFrame(tick);
      if (!lastTs) lastTs = ts;
      const dt = Math.min(48, ts - lastTs) / 1000;
      lastTs = ts;
      for (const row of rows) {
        if (row.paused || reduced || !row.loopWidth) continue;
        row.offset += SPEED_PX_PER_SEC * dt;
        wrapOffset(row);
        applyTransform(row);
      }
    };

    const startLoop = () => {
      if (rafId || reduced) return;
      lastTs = 0;
      rafId = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (!rafId) return;
      cancelAnimationFrame(rafId);
      rafId = 0;
      lastTs = 0;
    };

    const mount = () => {
      if (mounted) return;
      mounted = true;
      reduced = prefersReducedMotion();
      root.classList.toggle("is-reduced", reduced);
      root.replaceChildren();

      const buckets = splitRows();
      buckets.forEach((bucket, rowIndex) => {
        if (!bucket.length) return;
        const viewport = document.createElement("div");
        viewport.className = "nknk-marquee";
        viewport.dataset.direction = rowIndex % 2 === 0 ? "left" : "right";
        const track = document.createElement("div");
        track.className = "nknk-marquee-track";
        const fragment = document.createDocumentFragment();
        bucket.forEach(({ item, index }) => fragment.appendChild(createButton(item, index, { clone: false })));
        // Duplicate track for seamless loop (hidden from AT / tab order).
        if (!reduced) {
          bucket.forEach(({ item, index }) => fragment.appendChild(createButton(item, index, { clone: true })));
        }
        track.appendChild(fragment);
        viewport.appendChild(track);
        root.appendChild(viewport);

        const row = {
          viewport,
          track,
          direction: rowIndex % 2 === 0 ? -1 : 1,
          offset: 0,
          loopWidth: 0,
          paused: true,
          hover: false,
          focus: false,
          dragging: false
        };
        rows.push(row);
        bindRowInteractions(row);
      });

      // Measure after layout; images may still be loading so remeasure on load.
      const remasure = () => {
        for (const row of rows) {
          row.loopWidth = reduced ? 0 : measureLoopWidth(row.track);
          wrapOffset(row);
          if (!reduced) applyTransform(row);
        }
      };
      remasure();
      root.querySelectorAll("img").forEach((img) => {
        if (img.complete) return;
        img.addEventListener("load", remasure, { once: true });
      });
      window.addEventListener("resize", remasure);

      syncChromeLabels();
      syncPauseState();
      if (!reduced) startLoop();
    };

    closeBtn?.addEventListener("click", closeLightbox);
    prevBtn?.addEventListener("click", () => openAt(lightboxIndex - 1));
    nextBtn?.addEventListener("click", () => openAt(lightboxIndex + 1));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) closeLightbox();
    });

    document.addEventListener("keydown", (event) => {
      if (!lightboxOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeLightbox();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        openAt(lightboxIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        openAt(lightboxIndex + 1);
      }
    });

    image.addEventListener("touchstart", (event) => {
      if (!lightboxOpen || event.changedTouches.length !== 1) return;
      touchStartX = event.changedTouches[0].clientX;
      touchStartY = event.changedTouches[0].clientY;
    }, { passive: true });
    image.addEventListener("touchend", (event) => {
      if (!lightboxOpen || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) openAt(lightboxIndex + 1);
      else openAt(lightboxIndex - 1);
    }, { passive: true });

    document.addEventListener("visibilitychange", () => {
      pageVisible = !document.hidden;
      syncPauseState();
    });

    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motionQuery?.addEventListener?.("change", () => {
      // Rebuild to switch between marquee loop and scroll-snap row.
      mounted = false;
      stopLoop();
      rows.length = 0;
      if (sectionVisible) mount();
    });

    window.addEventListener("languagechange", syncChromeLabels);

    const target = section || root;
    if (typeof IntersectionObserver === "undefined") {
      sectionVisible = true;
      mount();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some(entry => entry.isIntersecting);
      sectionVisible = visible;
      if (visible) mount();
      syncPauseState();
    }, { rootMargin: "300px 0px" });
    observer.observe(target);
  }

  document.addEventListener("DOMContentLoaded", initNknkGallery);
})();
