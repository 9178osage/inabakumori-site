// Native disclosure controls keep every link and explanation readable without JavaScript.
// On wide screens the original sections stay expanded; on phones they start compact.
(() => {
  const media = window.matchMedia?.("(max-width: 700px), (pointer: coarse) and (max-width: 1000px)");
  if (!media) return;
  const folds = [...document.querySelectorAll("[data-mobile-fold]")];
  const mobileOpen = new WeakMap();
  let wasMobile = media.matches;
  let syncing = false;
  function revealHash() {
    let target;
    try { target = document.getElementById(decodeURIComponent(window.location.hash.slice(1))); } catch { return; }
    if (!target) return;
    folds.forEach(fold => {
      if (fold.contains(target) || target.contains(fold)) {
        fold.open = true;
        mobileOpen.set(fold, true);
      }
    });
  }
  function sync() {
    syncing = true;
    // A native toggle event can still be queued when the viewport changes.
    // Capture the actual phone state before opening every section on desktop.
    if (wasMobile && !media.matches) folds.forEach(fold => mobileOpen.set(fold, fold.open));
    folds.forEach(fold => { fold.open = !media.matches || mobileOpen.get(fold) === true; });
    revealHash();
    wasMobile = media.matches;
    syncing = false;
  }
  folds.forEach(fold => fold.addEventListener("toggle", () => {
    if (!syncing && media.matches) mobileOpen.set(fold, fold.open);
  }));
  if (media.addEventListener) media.addEventListener("change", sync);
  else media.addListener?.(sync);
  window.addEventListener("hashchange", revealHash);
  sync();
})();
