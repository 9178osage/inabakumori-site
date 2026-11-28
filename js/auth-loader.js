(() => {
  // Dynamic import obeys script-src 'self' without a TrustedScriptURL DOM sink.
  const bundleUrl = new URL("./auth.js?v=20261028lazy", document.currentScript.src).href;
  const localHttp = window.location.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const prefix = localHttp ? "" : "__Host-station-";
  let loading;
  let loaded = false;
  let attempts = 0;
  let opening = false;
  let unavailable = false;
  // Only picks the language of the loader's own error messages; blocked storage falls back to Chinese.
  const readLanguage = () => {
    try { return (window.siteStorage || localStorage).getItem("language"); } catch { return null; }
  };
  const text = (zh, en, ja) => ({ zh, en, ja }[readLanguage()] || zh);
  function hasLocalSession() {
    try {
      return document.cookie.split(";").some(part => {
        const pair = part.trim();
        const equals = pair.indexOf("=");
        return ["st-access-token", "st-refresh-token", "sFrontToken"].some(name => pair.slice(0, equals) === prefix + name) && pair.slice(equals + 1) !== "";
      });
    } catch { return false; }
  }
  // Clear legacy query tokens before fetching another resource. Persist the reset
  // payload in sessionStorage so a refresh after a failed SDK load can still consume it.
  const AUTH_RESET_KEY = "inabakumori-auth-reset";
  const readStoredAuthReset = () => {
    try {
      const data = JSON.parse(sessionStorage.getItem(AUTH_RESET_KEY) || "null");
      if (!data || data.requested !== true || typeof data.token !== "string" || typeof data.tenantId !== "string") return null;
      return { requested: true, token: data.token, tenantId: data.tenantId || "public" };
    } catch { return null; }
  };
  const writeStoredAuthReset = data => {
    try { sessionStorage.setItem(AUTH_RESET_KEY, JSON.stringify(data)); } catch { /* Storage may be blocked. */ }
  };
  const resetUrl = new URL(window.location.href);
  const hashParams = resetUrl.hash.includes("token=") ? new URLSearchParams(resetUrl.hash.slice(1)) : null;
  const resetRequested = resetUrl.searchParams.get("resetPassword") === "1" || Boolean(hashParams?.get("token"));
  if (resetRequested) {
    window.siteAuthReset = { requested: true, token: hashParams?.get("token") || resetUrl.searchParams.get("token") || "",
      tenantId: hashParams?.get("tenantId") || resetUrl.searchParams.get("tenantId") || "public" };
    writeStoredAuthReset(window.siteAuthReset);
    for (const key of ["resetPassword", "token", "tenantId"]) resetUrl.searchParams.delete(key);
    if (hashParams) {
      hashParams.delete("token"); hashParams.delete("tenantId");
      resetUrl.hash = hashParams.toString();
    }
    window.history.replaceState(window.history.state, "", resetUrl.pathname + resetUrl.search + resetUrl.hash);
  } else {
    const stored = readStoredAuthReset();
    if (stored) window.siteAuthReset = stored;
  }
  function updateLoaderButton() {
    if (loaded) return;
    const button = document.getElementById("auth-btn");
    if (button) button.innerText = unavailable
      ? text("登录加载失败，点击重试", "Sign-in unavailable. Retry", "ログインを再読み込み")
      : text("登录 / 注册", "Sign In / Sign Up", "ログイン / 新規登録");
  }
  function loadAuth() {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    attempts++;
    loading = import(attempts === 1 ? bundleUrl : `${bundleUrl}&retry=${attempts}`).then(() => {
      loaded = true;
    }).catch(error => {
      loading = undefined;
      unavailable = true;
      updateLoaderButton();
      throw error;
    });
    return loading;
  }
  const originalFetch = window.siteFetch;
  window.siteFetch = async (...args) => {
    // Public uncredentialed reads (the comment wall) must not wait on the SDK or
    // fail when the bundle cannot be loaded (audit P1-4).
    if (args[1]?.credentials === "omit") return originalFetch(...args);
    // A returning member's first write must wait for the SDK's header interceptor.
    if (hasLocalSession() || loading) await loadAuth();
    return originalFetch(...args);
  };
  window.hasCommentSession = async () => {
    if (!hasLocalSession()) return false;
    await loadAuth();
    return window.hasCommentSession();
  };
  // The caller passes the control it was clicked from, so the dialog can return focus there even
  // after the SDK download moved focus (audit #15).
  window.openAuthModal = async trigger => {
    if (opening) return;
    opening = true;
    const button = document.getElementById("auth-btn");
    const opener = trigger && trigger.nodeType === 1 ? trigger : button;
    button?.setAttribute("aria-busy", "true");
    button?.setAttribute("aria-disabled", "true");
    try {
      await loadAuth();
      await window.openAuthModal(opener);
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
  window.addEventListener("languagechange", updateLoaderButton);
  window.addEventListener("pageshow", event => {
    if (!event.persisted || loaded) return;
    if (hasLocalSession()) loadAuth().then(() => window.dispatchEvent(new Event("authchange"))).catch(() => {});
    else updateLoaderButton();
  });
  updateLoaderButton();
  if (hasLocalSession() || resetRequested) loadAuth().catch(() => {});
})();
