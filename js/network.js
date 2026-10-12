(() => {
  // Resolve fetch at call time: SuperTokens installs its session-aware wrapper later.
  // Never retry a write automatically; a timed-out write may already have succeeded.
  window.siteFetch = (url, options = {}) => fetch(url, {
    ...options,
    signal: options.signal || timeoutSignal(15000)
  });
  // AbortSignal.timeout is missing before Safari/iOS 16; without this every API call would throw.
  function timeoutSignal(ms) {
    if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
    const controller = new AbortController();
    setTimeout(() => {
      try { controller.abort(new DOMException("signal timed out", "TimeoutError")); } catch { controller.abort(); }
    }, ms);
    return controller.signal;
  }
})();
