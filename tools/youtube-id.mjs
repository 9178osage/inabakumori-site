// The one strict YouTube video-ID parser for build tools. script.js keeps an identical
// copy (youtubeVideoId) for the browser; tools/tests/youtube-id.test.cjs checks both
// against the same cases. Imports nothing, so the API-key job still runs no dependency code.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

export function youtubeVideoId(value) {
  if (typeof value !== "string") return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  let id = null;
  if (url.hostname === "youtu.be") {
    const parts = url.pathname.split("/");
    if (parts.length === 2) id = parts[1];
  } else if (WATCH_HOSTS.has(url.hostname)) {
    if (url.pathname === "/watch") {
      const values = url.searchParams.getAll("v");
      if (values.length === 1) id = values[0];
    } else {
      id = /^\/(?:embed|shorts)\/([^/]+)$/u.exec(url.pathname)?.[1] ?? null;
    }
  }
  return id !== null && VIDEO_ID.test(id) ? id : null;
}
