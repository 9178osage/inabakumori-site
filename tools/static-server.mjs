import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = process.argv.includes("--dist") ? path.join(project, "dist") : project;
const entrypoints = new Set(["index.html", "404.html", "style.css", "favicon.ico", "site.webmanifest", "robots.txt", "sitemap.xml"]);
const scripts = new Set(["script.js", ...["preferences", "config", "network", "i18n", "auth", "songs", "experience", "comments"].map(name => `js/${name}.js`)]);
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2" };
export function publicPath(url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url, "http://localhost").pathname).replace(/^\/+/, ""); }
  catch { return null; }
  if (!pathname) return "index.html";
  if (pathname.split("/").some(part => part.startsWith(".") || !part) || pathname.includes("\\")) return null;
  if (entrypoints.has(pathname) || scripts.has(pathname)) return pathname;
  if (/^images\/[\w/-]+\.(png|jpe?g|webp|ico)$/iu.test(pathname)) return pathname;
  if (/^fonts\/[\w-]+\.(woff2|css|txt)$/iu.test(pathname)) return pathname;
  return null;
}
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  // Scripts use a few inline handlers; styles include rain variables. Keep object/base/frame locked down.
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: https://i.ytimg.com https://img.youtube.com; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://inabakumori-site-production.up.railway.app http://127.0.0.1:3001 http://localhost:3001"
};

export function createStaticServer(directory = root) {
  return http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
    const file = publicPath(req.url);
    if (file) {
      try {
        const data = await readFile(path.join(directory, file));
        res.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" });
        return res.end(req.method === "HEAD" ? undefined : data);
      } catch { /* Return a neutral 404; never a directory listing or filesystem path. */ }
    }
    try {
      const data = await readFile(path.join(directory, "404.html"));
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(req.method === "HEAD" ? undefined : "Not found");
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.FRONTEND_PORT || 5500);
  const server = createStaticServer();
  server.listen(port, "127.0.0.1", () => console.log(`Station preview: http://127.0.0.1:${port}${root.endsWith("dist") ? " (production build)" : ""}`));
  server.on("error", error => { console.error(`Preview unavailable: ${error.code}`); process.exitCode = 1; });
}
