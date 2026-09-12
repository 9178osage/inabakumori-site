(() => {
  const { hostname, origin } = window.location;
  const local = hostname === "127.0.0.1" || hostname === "localhost";
  window.APP_CONFIG = {
    // 上线默认使用网站同域的 /auth 和 /api 路径。
    // 如果后端使用独立域名，将下面的值替换为实际 HTTPS 后端域名。
    apiDomain: local ? `${window.location.protocol}//${hostname}:3001` : origin
  };
})();
