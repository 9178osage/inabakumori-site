// Production links to the SuperTokens Core and PostgreSQL must be encrypted and verified.
// Plain links stay allowed only for loopback, a Unix socket, or hosts the operator lists in
// TRUSTED_PLAINTEXT_HOSTS (comma-separated host names on a private, otherwise protected network).
// Messages name only the configuration variable, never its value.
import { isIP } from "node:net";

export function trustedPlaintextHosts(env) {
  return new Set(String(env.TRUSTED_PLAINTEXT_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean));
}

export function isLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/gu, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  return isIP(host) === 4 && host.startsWith("127.");
}

function plaintextAllowed(hostname, trusted) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/gu, "");
  return !host || host.startsWith("/") || isLocalHost(host) || trusted.has(host);
}

// SUPERTOKENS_CONNECTION_URI may list several Core addresses separated by ";".
export function coreTransportProblem(value, env = {}) {
  const trusted = trustedPlaintextHosts(env);
  const uris = String(value ?? "").split(";").map(part => part.trim()).filter(Boolean);
  if (!uris.length) return "SUPERTOKENS_CONNECTION_URI is empty";
  for (const uri of uris) {
    let url;
    try { url = new URL(uri); } catch { return "SUPERTOKENS_CONNECTION_URI must be a full URL"; }
    if (url.protocol === "https:") continue;
    if (url.protocol === "http:" && plaintextAllowed(url.hostname, trusted)) continue;
    return "Production SUPERTOKENS_CONNECTION_URI must use HTTPS (plain HTTP only for loopback or TRUSTED_PLAINTEXT_HOSTS)";
  }
  return null;
}

// Mirrors how pg 8 resolves TLS: sslmode/ssl in the URL, otherwise PGSSLMODE.
// In pg 8, sslmode=require/prefer/verify-ca/verify-full verify the server certificate;
// no-verify, uselibpqcompat=true (libpq semantics) and disabling TLS do not.
export function postgresTransportProblem(connectionString, env = {}) {
  let url;
  try { url = new URL(connectionString); } catch { return "DATABASE_URL must be a PostgreSQL connection URL"; }
  const params = url.searchParams;
  const last = name => { const values = params.getAll(name); return values.length ? values.at(-1) : null; };
  // pg/pg-connection-string take the last repeated query parameter; URLSearchParams.get() would take the first (audit P2-1).
  let host = last("host");
  if (host == null) {
    try { host = decodeURIComponent(url.hostname); }
    catch { return "DATABASE_URL must be a PostgreSQL connection URL"; }
  }
  if (plaintextAllowed(host, trustedPlaintextHosts(env))) return null;
  const insecure = "Production DATABASE_URL must use TLS with certificate verification (e.g. sslmode=require or verify-full; not disable, allow or no-verify)";
  if (last("uselibpqcompat") === "true" && !["verify-ca", "verify-full"].includes(last("sslmode"))) return insecure;
  // pg compares PGSSLMODE exactly; do not trim or lowercase it (audit P2-1).
  const mode = last("sslmode") ?? (params.has("ssl") ? null : String(env.PGSSLMODE ?? ""));
  if (params.has("ssl") && !last("sslmode")) {
    return ["true", "1"].includes(last("ssl")) ? null : insecure;
  }
  if (["require", "prefer", "verify-ca", "verify-full"].includes(mode)) return null;
  return insecure;
}
