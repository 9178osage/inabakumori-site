(() => {
  const { hostname } = window.location;
  const local = hostname === "127.0.0.1" || hostname === "localhost";
  const assetOrigin = "https://inabakumori-assets.pages.dev";
  window.APP_CONFIG = {
    apiDomain: local ? `${window.location.protocol}//${hostname}:3001` : "https://inabakumori-backend.vercel.app",
    // Disable this flag to return the six pilot thumbnails to their local sources.
    assetPilot: {
      enabled: !local,
      origin: assetOrigin,
      thumbnails: {
        "images/optimized/nknk/mobile/1.webp": `${assetOrigin}/assets/nknk-mobile-1-f1320c102bf90a91.webp`,
        "images/optimized/nknk/mobile/2.webp": `${assetOrigin}/assets/nknk-mobile-2-c23831828b10fed4.webp`,
        "images/optimized/nknk/mobile/3.webp": `${assetOrigin}/assets/nknk-mobile-3-7c0480e3d5188aaf.webp`,
        "images/optimized/nknk/mobile/4.webp": `${assetOrigin}/assets/nknk-mobile-4-44ada443c3d015c2.webp`,
        "images/optimized/nknk/mobile/5.webp": `${assetOrigin}/assets/nknk-mobile-5-f7b4e442bb8d9ef1.webp`,
        "images/optimized/nknk/mobile/6.webp": `${assetOrigin}/assets/nknk-mobile-6-2423dc380b7bc1ca.webp`
      }
    }
  };
})();

window.MOBILE_BACKGROUNDS = {
  lazy: true,
  // Keep the first image's cache version aligned with index.html's preload and <source>.
  files: Array.from({ length: 8 }, (_, index) => `${String(index + 1).padStart(3, "0")}.webp${index === 0 ? "?v=3" : ""}`),
  folder: "images/optimized/hero-mobile/",
  extensions: ["png", "jpg", "jpeg"],
  maxImages: 99
};
