(() => {
  // Resolve fetch at call time: SuperTokens installs its session-aware wrapper later.
  // Never retry a write automatically; a timed-out write may already have succeeded.
  window.siteFetch = (url, options = {}) => fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(15000)
  });
})();
