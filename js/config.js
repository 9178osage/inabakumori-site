(() => {
  const { hostname } = window.location;
  const local = hostname === "127.0.0.1" || hostname === "localhost";
  window.APP_CONFIG = { apiDomain: local ? `${window.location.protocol}//${hostname}:3001` : "https://inabakumori-site-production.up.railway.app" };
})();

window.MOBILE_BACKGROUNDS = {
  files: ["001.jpg", "002.jpg", "003.jpg", "004.jpg", "005.png", "006.jpg", "007.jpg", "008.jpg"],
  folder: "images/hero-mobile/",
  extensions: ["png", "jpg", "jpeg"],
  maxImages: 99
};
