(() => {
  // Dynamic import obeys script-src 'self' without a TrustedScriptURL DOM sink.
  const bundleUrl = new URL("./auth.js?v=20261028lazy", document.currentScript.src).href;
  const localHttp = window.location.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const prefix = localHttp ? "" : "__Host-station-";
  let loading;
  let loaded = false;
  let attempts = 0;
  let opening = false;
  const text = (zh, en, ja) => ({ zh, en, ja }[(window.siteStorage || localStorage).getItem("language")] || zh);
  function hasLocalSession() {
    try {
      return document.cookie.split(";").some(part => {
        const pair = part.trim();
        const equals = pair.indexOf("=");
        return ["st-access-token", "st-refresh-token", "sFrontToken"].some(name => pair.slice(0, equals) === prefix + name) && pair.slice(equals + 1) !== "";
      });
    } catch { return false; }
  }
  // Clear legacy query tokens before fetching another resource. Keep the reset
  // input only in page memory until the SDK module consumes it.
  const resetUrl = new URL(window.location.href);
  const hashParams = resetUrl.hash.includes("token=") ? new URLSearchParams(resetUrl.hash.slice(1)) : null;
  const resetRequested = resetUrl.searchParams.get("resetPassword") === "1" || Boolean(hashParams?.get("token"));
  if (resetRequested) {
    window.siteAuthReset = { requested: true, token: hashParams?.get("token") || resetUrl.searchParams.get("token") || "",
      tenantId: hashParams?.get("tenantId") || resetUrl.searchParams.get("tenantId") || "public" };
    for (const key of ["resetPassword", "token", "tenantId"]) resetUrl.searchParams.delete(key);
    if (hashParams) {
      hashParams.delete("token"); hashParams.delete("tenantId");
      resetUrl.hash = hashParams.toString();
    }
    window.history.replaceState(window.history.state, "", resetUrl.pathname + resetUrl.search + resetUrl.hash);
  }
  function markUnavailable() {
    const button = document.getElementById("auth-btn");
    if (button) button.innerText = text("登录加载失败，点击重试", "Sign-in unavailable. Retry", "ログインを再読み込み");
  }
  function loadAuth() {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    attempts++;
    loading = import(attempts === 1 ? bundleUrl : `${bundleUrl}&retry=${attempts}`).then(() => {
      loaded = true;
    }).catch(error => {
      loading = undefined;
      markUnavailable();
      throw error;
    });
    return loading;
  }
  const originalFetch = window.siteFetch;
  window.siteFetch = async (...args) => {
    // A returning member's first write must wait for the SDK's header interceptor.
    if (hasLocalSession() || loading) await loadAuth();
    return originalFetch(...args);
  };
  window.hasCommentSession = async () => {
    if (!hasLocalSession()) return false;
    await loadAuth();
    return window.hasCommentSession();
  };
  window.openAuthModal = async () => {
    if (opening) return;
    opening = true;
    const button = document.getElementById("auth-btn");
    button?.setAttribute("aria-busy", "true");
    button?.setAttribute("aria-disabled", "true");
    try {
      await loadAuth();
      await window.openAuthModal();
    } catch {
      alert(text("无法加载登录功能，请检查网络后重试。", "Could not load sign-in. Check your connection and retry.", "ログインを読み込めません。接続を確認して再試行してください。"));
    } finally {
      opening = false;
      button?.setAttribute("aria-busy", "false");
      button?.setAttribute("aria-disabled", "false");
    }
  };
  window.addEventListener("storage", event => {
    if (event.key !== "auth-sync" || loaded || !hasLocalSession()) return;
    loadAuth().then(() => window.dispatchEvent(new Event("authchange"))).catch(() => {});
  });
  if (hasLocalSession() || resetRequested) loadAuth().catch(() => {});
})();
