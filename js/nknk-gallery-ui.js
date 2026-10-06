(() => {
  const SPEED_PX_PER_SEC = 30;
  const DRAG_THRESHOLD = 6;
  const ROW_COUNT = 1;
  // Thumbs for the first EAGER_THUMBS illustrations load immediately; the rest load once they
  // come within THUMB_LOOKAHEAD_PX of the marquee viewport (≈50 s ahead at 30 px/s).
  const EAGER_THUMBS = 15;
  const THUMB_LOOKAHEAD_PX = 1600;

  // Enter/Space (and assistive-tech activation) dispatch a click with detail === 0. Pointer
  // clicks have detail >= 1 and are handled on pointerup so drags can be told apart.
  const isKeyboardActivation = (event) => event?.detail === 0;

  // Returns the control Tab / Shift+Tab should wrap to, or null to let focus move normally.
  const focusTrapTarget = (focusables, active, backwards) => {
    if (!focusables.length) return null;
    const index = focusables.indexOf(active);
    const last = focusables.length - 1;
    if (index === -1) return backwards ? focusables[last] : focusables[0];
    if (backwards && index === 0) return focusables[last];
    if (!backwards && index === last) return focusables[0];
    return null;
  };

  if (typeof window !== "undefined") {
    window.NKNKGalleryUI = Object.freeze({ isKeyboardActivation, focusTrapTarget, EAGER_THUMBS, THUMB_LOOKAHEAD_PX });
  }

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
      error: { zh: "图片加载失败", en: "Image failed to load", ja: "画像を読み込めませんでした" }
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
    let inertState = [];
    let imageFallbackTried = false;
    let thumbObserver = null;
    // Deferred thumbs need known dimensions so their slots do not collapse before loading.
    const canDeferThumbs = items.every(item => item.w > 0 && item.h > 0);

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
      imageFallbackTried = false;
      lightbox.classList.remove("is-error");
      if (item.w > 0 && item.h > 0) {
        // Full images share the thumb's aspect ratio; this reserves the box before decode.
        image.width = item.w;
        image.height = item.h;
      }
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
      // Same pattern as the easter-egg dialog: make everything behind the dialog inert.
      inertState = [...document.body.children]
        .filter(node => node !== lightbox && node.tagName !== "SCRIPT")
        .map(node => [node, node.inert]);
      inertState.forEach(([node]) => { node.inert = true; });
      document.body.classList.add("nknk-lightbox-open");
      syncPauseState();
      closeBtn?.focus();
    };

    const closeLightbox = () => {
      if (!lightboxOpen) return;
      lightboxOpen = false;
      lightbox.hidden = true;
      image.removeAttribute("src");
      lightbox.classList.remove("is-error");
      document.body.classList.remove("nknk-lightbox-open");
      inertState.forEach(([node, wasInert]) => { node.inert = wasInert; });
      inertState = [];
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
      img.alt = clone ? "" : altFor(item.id);
      img.decoding = "async";
      img.draggable = false;
      if (item.w > 0 && item.h > 0) {
        img.width = item.w;
        img.height = item.h;
        img.style.aspectRatio = `${item.w} / ${item.h}`;
      }
      if (!canDeferThumbs || (!clone && absoluteIndex < EAGER_THUMBS)) {
        img.loading = "eager";
        img.src = item.thumb;
      } else {
        img.dataset.src = item.thumb;
      }
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

    // The viewport clips with overflow:hidden, so focusing an off-screen item makes the browser
    // scroll it (scrollLeft), which fights the transform-based loop. Undo that scroll and move
    // the loop offset instead so the focused item is centred and its focus ring visible.
    const revealFocusedItem = (row, button) => {
      if (reduced || !button) return;
      const { viewport, track } = row;
      if (viewport.scrollLeft) viewport.scrollLeft = 0;
      const viewRect = viewport.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      if (rect.left >= viewRect.left && rect.right <= viewRect.right) return;
      const position = rect.left - track.getBoundingClientRect().left;
      const maxShift = Math.max(0, track.scrollWidth - viewport.clientWidth);
      const shift = Math.min(maxShift, Math.max(0, position - (viewport.clientWidth - rect.width) / 2));
      // applyTransform renders -offset for leftward rows and +offset for rightward rows.
      row.offset = row.direction < 0 ? shift : -shift;
      applyTransform(row);
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

      const onPointerUp = (event, cancelled = false) => {
        if (pointerId == null || event.pointerId !== pointerId) return;
        pointerId = null;
        row.dragging = false;
        viewport.classList.remove("is-dragging");
        try { viewport.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
        // pointercancel (e.g. the page starts scrolling vertically) must never open the lightbox.
        const shouldClick = !cancelled && !moved && activeButton;
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
      viewport.addEventListener("pointercancel", event => onPointerUp(event, true));
      viewport.addEventListener("pointerleave", () => {
        if (pointerId != null) return;
        row.hover = false;
        syncPauseState();
      });
      viewport.addEventListener("pointerenter", () => {
        row.hover = true;
        syncPauseState();
      });
      viewport.addEventListener("focusin", (event) => {
        row.focus = true;
        syncPauseState();
        revealFocusedItem(row, event.target.closest?.(".nknk-marquee-item"));
      });
      viewport.addEventListener("scroll", () => {
        if (reduced || !viewport.scrollLeft) return;
        const active = viewport.contains(document.activeElement) ? document.activeElement.closest?.(".nknk-marquee-item") : null;
        viewport.scrollLeft = 0;
        revealFocusedItem(row, active);
      }, { passive: true });
      viewport.addEventListener("focusout", () => {
        // Defer so focus moving within the row does not briefly resume.
        queueMicrotask(() => {
          row.focus = viewport.contains(document.activeElement);
          syncPauseState();
        });
      });

      // Reduced motion: every click opens. Marquee mode: pointer clicks were already handled on
      // pointerup (to distinguish drags), so only keyboard activation opens here.
      track.addEventListener("click", (event) => {
        if (!reduced && !isKeyboardActivation(event)) {
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

    const remeasure = () => {
      for (const row of rows) {
        row.loopWidth = reduced ? 0 : measureLoopWidth(row.track);
        wrapOffset(row);
        if (!reduced) applyTransform(row);
      }
    };

    const loadThumb = (img) => {
      const src = img.dataset.src;
      if (!src) return;
      img.removeAttribute("data-src");
      img.src = src;
    };

    const observeDeferredThumbs = () => {
      thumbObserver?.disconnect();
      thumbObserver = null;
      const pending = rows.flatMap(row => [...row.track.querySelectorAll("img[data-src]")]);
      if (!pending.length) return;
      if (typeof IntersectionObserver === "undefined") {
        pending.forEach(loadThumb);
        return;
      }
      // root must be the clipping viewport itself: ancestor overflow clipping is applied before
      // rootMargin, so a document-level observer would only fire once a thumb is already visible.
      const observers = rows.map(row => new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          loadThumb(entry.target);
        }
      }, { root: row.viewport, rootMargin: `0px ${THUMB_LOOKAHEAD_PX}px` }));
      rows.forEach((row, index) => row.track.querySelectorAll("img[data-src]").forEach(img => observers[index].observe(img)));
      thumbObserver = { disconnect: () => observers.forEach(observer => observer.disconnect()) };
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

      // Slots are sized from the generated thumb dimensions; still remeasure once eager thumbs
      // load in case the config lacks dimensions.
      remeasure();
      root.querySelectorAll("img[src]").forEach((img) => {
        if (img.complete) return;
        img.addEventListener("load", remeasure, { once: true });
      });
      observeDeferredThumbs();

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

    image.addEventListener("error", () => {
      if (!lightboxOpen || !image.getAttribute("src")) return;
      const item = items[lightboxIndex];
      if (!item) return;
      // Fall back to the (already cached) thumb once, then show a localized message.
      if (!imageFallbackTried && item.thumb && image.getAttribute("src") !== item.thumb) {
        imageFallbackTried = true;
        image.src = item.thumb;
        return;
      }
      lightbox.classList.add("is-error");
      if (caption) caption.textContent = `${altFor(item.id)} · ${chromeLabel("error")}`;
    });
    image.addEventListener("load", () => lightbox.classList.remove("is-error"));

    window.addEventListener("resize", remeasure);

    document.addEventListener("keydown", (event) => {
      if (!lightboxOpen) return;
      if (event.key === "Tab") {
        const focusables = [closeBtn, prevBtn, nextBtn].filter(control => control && !control.hidden && !control.disabled);
        const target = focusTrapTarget(focusables, document.activeElement, event.shiftKey);
        if (target) {
          event.preventDefault();
          target.focus();
        }
        return;
      }
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
      mount();
      syncPauseState();
    });

    window.addEventListener("languagechange", syncChromeLabels);

    // Mount immediately so the row has height as soon as JS runs. IntersectionObserver
    // only toggles sectionVisible (auto-scroll pause) — never gates first paint.
    mount();

    const target = section || root;
    if (typeof IntersectionObserver === "undefined") {
      sectionVisible = true;
      syncPauseState();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      sectionVisible = entries.some(entry => entry.isIntersecting);
      syncPauseState();
    }, { rootMargin: "400px 0px" });
    observer.observe(target);
    // Synchronous first paint may be offscreen; treat as not visible until IO reports.
    sectionVisible = false;
    syncPauseState();
  }

  document.addEventListener("DOMContentLoaded", initNknkGallery);
})();
