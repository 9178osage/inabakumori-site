// Keep a failed cold-start connection recoverable without exposing driver text.
// Once opened, retain the driver's pool so its own reconnection logic can work.
export function createDatabaseAccess({ open, kind, now = Date.now, retryMs = 5000, log = console }) {
  if (typeof open !== "function" || typeof now !== "function" || !["postgres", "sqlite"].includes(kind) ||
      !Number.isSafeInteger(retryMs) || retryMs < 0) throw new TypeError("Invalid database access configuration");
  let current;
  let opening;
  let lastFailure;
  let retryAt = 0;
  let closed = false;
  let closing;
  const safeFailures = new WeakSet();

  function safeFailure(message = "Database unavailable") {
    const error = Object.assign(new Error(message), { code: "DATABASE_UNAVAILABLE" });
    safeFailures.add(error);
    return error;
  }

  function unavailable(error) {
    // Driver messages, causes, queries and addresses must never leave this layer.
    const metadata = { name: typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(error.name) ? error.name : "Error" };
    if (typeof error?.code === "string" && /^(?:[A-Z0-9]{5}|E[A-Z0-9_]{1,63})$/u.test(error.code)) metadata.code = error.code;
    try { log.error?.("Database access failed", metadata); } catch {}
    return safeFailure();
  }

  function ready() {
    if (closed) return Promise.reject(safeFailure("Database access is closed"));
    if (current) return Promise.resolve(current);
    if (opening) return opening;
    if (lastFailure && now() < retryAt) return Promise.reject(lastFailure);
    opening = Promise.resolve().then(open).then(database => {
      current = database;
      lastFailure = undefined;
      retryAt = 0;
      return database;
    }).catch(error => {
      if (error?.code === "DATABASE_CONFIG") {
        lastFailure = error;
        retryAt = Infinity;
      } else {
        lastFailure = unavailable(error);
        retryAt = now() + retryMs;
      }
      throw lastFailure;
    }).finally(() => { opening = undefined; });
    return opening;
  }

  async function invoke(operation, preserveError = false) {
    try { return await operation(); }
    catch (error) {
      if (preserveError || kind === "sqlite" || error?.code === "DATABASE_CONFIG" || safeFailures.has(error)) throw error;
      throw unavailable(error);
    }
  }

  function access(database, isActive = () => true) {
    return {
      prepare(sql) {
        return Object.fromEntries(["get", "all", "run"].map(method => [method, (...parameters) => {
          // Preserve the underlying transaction's already-closed check when a
          // caller retains a statement past the lifetime of its callback.
          const preserveError = !isActive();
          return invoke(async () => (await database()).prepare(sql)[method](...parameters), preserveError);
        }]));
      },
      exec(sql) {
        const preserveError = !isActive();
        return invoke(async () => (await database()).exec(sql), preserveError);
      }
    };
  }

  return {
    ...access(ready),
    kind,
    get databasePath() { return current?.databasePath ?? null; },
    ready,
    async transaction(callback) {
      const database = await ready();
      let callbackFailure;
      try {
        return await database.transaction(async transaction => {
          let active = true;
          try { return await callback(access(() => transaction, () => active)); }
          catch (error) { callbackFailure = { error }; throw error; }
          finally { active = false; }
        });
      } catch (error) {
        if (callbackFailure && error === callbackFailure.error) throw error;
        return invoke(() => { throw error; });
      }
    },
    snapshot(destination) {
      return invoke(async () => (await ready()).snapshot(destination));
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        try { await opening; } catch {}
        const database = current;
        current = undefined;
        if (database) await invoke(() => database.close());
      })();
      return closing;
    }
  };
}
