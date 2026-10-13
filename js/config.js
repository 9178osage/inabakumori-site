(() => {
  const { hostname } = window.location;
  const local = hostname === "127.0.0.1" || hostname === "localhost";
  window.APP_CONFIG = { apiDomain: local ? `${window.location.protocol}//${hostname}:3001` : "https://inabakumori-site-production.up.railway.app" };
})();

window.MOBILE_BACKGROUNDS = {
  lazy: true,
  // Keep the first image's cache version aligned with index.html's preload and <source>.
  files: Array.from({ length: 8 }, (_, index) => `${String(index + 1).padStart(3, "0")}.webp${index === 0 ? "?v=3" : ""}`),
  folder: "images/optimized/hero-mobile/",
  extensions: ["png", "jpg", "jpeg"],
  maxImages: 99
};
