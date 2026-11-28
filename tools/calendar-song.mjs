// A song's official YouTube video in js/songs.js is the calendar's allowlist. Titles can change,
// and trailers or streams can mention a song title without being that song's release.
import { youtubeVideoId as videoId } from "./youtube-id.mjs";

export function newestSongRelease(items, songs) {
  const releases = new Map(songs
    .filter(song => typeof song.title === "string" && song.title.trim() && videoId(song.youtube))
    .map(song => [videoId(song.youtube), song.title]));
  return items
    .filter(item => item.creator === "inabakumori" && item.source === "youtube")
    .map(item => ({ item, song: releases.get(videoId(item.url)) }))
    .filter(match => match.song && Number.isFinite(Date.parse(match.item.publishedAt)))
    // Compare instants, not strings: "+09:00" and "Z" stamps of the same moment sort differently as text.
    .sort((a, b) => Date.parse(b.item.publishedAt) - Date.parse(a.item.publishedAt))[0] ?? null;
}
