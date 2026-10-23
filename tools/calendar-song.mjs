// A song's official YouTube video in js/songs.js is the calendar's allowlist. Titles can change,
// and trailers or streams can mention a song title without being that song's release.
function videoId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1)
      : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) && url.pathname === "/watch" ? url.searchParams.get("v") : null;
    return /^[A-Za-z0-9_-]{11}$/u.test(id ?? "") ? id : null;
  } catch { return null; }
}

export function newestSongRelease(items, songs) {
  const releases = new Map(songs
    .filter(song => typeof song.title === "string" && song.title.trim() && videoId(song.youtube))
    .map(song => [videoId(song.youtube), song.title]));
  return items
    .filter(item => item.creator === "inabakumori" && item.source === "youtube")
    .map(item => ({ item, song: releases.get(videoId(item.url)) }))
    .filter(match => match.song && Number.isFinite(Date.parse(match.item.publishedAt)))
    .sort((a, b) => b.item.publishedAt.localeCompare(a.item.publishedAt))[0] ?? null;
}
