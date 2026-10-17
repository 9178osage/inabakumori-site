import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, lstat } from "node:fs/promises";
import { assertRepoPath } from "./safe-fs.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = process.argv.includes("--dist") ? path.join(project, "dist") : project;
const entrypoints = new Set(["index.html", "404.html", "style.css", "favicon.ico", "site.webmanifest", "robots.txt", "sitemap.xml"]);
const scripts = new Set(["script.js", ...["preferences", "config", "network", "i18n", "auth", "songs", "nknk-gallery", "nknk-gallery-ui", "experience", "comments"].map(name => `js/${name}.js`)]);
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
  // Inline onclick handlers and rain style attributes removed; CSSOM / external sheets only.
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: https://i.ytimg.com https://img.youtube.com; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' https://inabakumori-site-production.up.railway.app http://127.0.0.1:3001 http://localhost:3001; frame-src 'none'; worker-src 'none'; manifest-src 'self'; require-trusted-types-for 'script'; trusted-types 'none'"
};

export function createStaticServer(directory = root) {
  const base = path.resolve(directory);
  // Include the serving directory itself in the symlink check, as well as assets
  // and their parents: URL allowlisting alone cannot keep linked private files out.
  const readPublicFile = async file => {
    const target = assertRepoPath(path.dirname(base), path.join(base, file), { mustExist: true });
    if (!(await lstat(target)).isFile()) throw new Error("Refusing non-regular preview file");
    return readFile(target);
  };
  return http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
    const file = publicPath(req.url);
    if (file) {
      try {
        const data = await readPublicFile(file);
        res.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" });
        return res.end(req.method === "HEAD" ? undefined : data);
      } catch { /* Return a neutral 404; never a directory listing or filesystem path. */ }
    }
    try {
      const data = await readPublicFile("404.html");
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
