(() => {
  const { hostname, origin } = window.location;
  const local = hostname === "127.0.0.1" || hostname === "localhost";
  window.APP_CONFIG = { apiDomain: local ? `${window.location.protocol}//${hostname}:3001` : origin };
})();
