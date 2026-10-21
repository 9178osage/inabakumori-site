// Host classification shared by the build (CSP) and link-checker tools.
import { BlockList, isIP } from "node:net";

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addSubnet("0.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");
loopback.addAddress("::", "ipv6");
loopback.addSubnet("::ffff:127.0.0.0", 104, "ipv6");
loopback.addSubnet("::ffff:0.0.0.0", 104, "ipv6");

const nonPublic = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]]) {
  nonPublic.addSubnet(network, prefix, "ipv4");
  nonPublic.addSubnet(`::ffff:${network}`, 96 + prefix, "ipv6");
}
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["64:ff9b::", 96]]) {
  nonPublic.addSubnet(network, prefix, "ipv6");
}

// Canonical hostname as a browser would see it: lower-case, no trailing dot, IPv4
// shorthands (127.1, 0x7f.1, 2130706433) expanded, IPv6 without brackets.
function canonicalHost(host) {
  let value = String(host ?? "").trim().toLowerCase().replace(/\.+$/u, "");
  if (!value) return "";
  try {
    value = new URL(`http://${value.includes(":") && !value.startsWith("[") ? `[${value}]` : value}/`).hostname;
  } catch { /* keep the raw value; callers treat unknown names conservatively */ }
  return value.replace(/^\[(.*)\]$/u, "$1").replace(/\.+$/u, "");
}

function addressFamily(host) {
  const version = isIP(host);
  return version === 4 ? "ipv4" : version === 6 ? "ipv6" : null;
}

function isLoopbackHost(host) {
  const value = canonicalHost(host);
  if (value === "localhost" || value.endsWith(".localhost")) return true;
  const family = addressFamily(value);
  return family ? loopback.check(value, family) : false;
}

export function isNonPublicHost(host) {
  const value = canonicalHost(host);
  if (!value || isLoopbackHost(value)) return true;
  if (value.endsWith(".local") || value.endsWith(".internal") || value.endsWith(".home.arpa") || !value.includes(".") && !addressFamily(value)) return true;
  const family = addressFamily(value);
  return family ? nonPublic.check(value, family) : false;
}

// Host part of a CSP source expression, or null for keywords ('self'), schemes (https:) and nonces.
function cspSourceHost(source) {
  if (/^'/u.test(source) || /^[a-z][a-z0-9+.-]*:$/iu.test(source)) return null;
  const withoutScheme = source.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "");
  const host = /^(\[[^\]]*\]|[^:/]*)/u.exec(withoutScheme)?.[1] ?? "";
  return host || null;
}

// A source that can reach a loopback service: a loopback host (any spelling, including
// *.localhost wildcards) or a bare "*" host / insecure scheme-only source that includes them.
export function isLoopbackCspSource(source) {
  if (source === "*" || /^(?:http|ws):$/iu.test(source)) return true;
  const host = cspSourceHost(source);
  if (host === null) return false;
  if (host === "*") return true;
  return isLoopbackHost(host.replace(/^\*\./u, ""));
}

export function loopbackCspSources(policy) {
  return String(policy).split(";").flatMap(directive => directive.trim().split(/\s+/u).slice(1)).filter(isLoopbackCspSource);
}

export function stripLoopbackCspSources(policy) {
  return String(policy).split(";").map(directive => {
    const [name, ...sources] = directive.trim().split(/\s+/u);
    if (!name) return directive;
    const kept = sources.filter(source => !isLoopbackCspSource(source));
    return ` ${[name, ...kept].join(" ")}`;
  }).join(";").replace(/^ /u, "");
}
