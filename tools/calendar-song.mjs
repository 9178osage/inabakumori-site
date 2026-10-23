// The calendar counts days since Inabakumori's newest *song*: a YouTube upload only counts when its
// title names a song from js/songs.js, so trailers, streams or other videos never reset the counter.
export function newestSongRelease(items, songs) {
  const titles = songs.map(song => song.title).filter(title => typeof title === "string" && title.trim());
  return items
    .filter(item => item.creator === "inabakumori" && item.source === "youtube" && typeof item.title === "string")
    .map(item => ({ item, song: titles.filter(title => item.title.includes(`『${title}』`) || item.title.trim() === title).sort((a, b) => b.length - a.length)[0] }))
    .filter(match => match.song && Number.isFinite(Date.parse(match.item.publishedAt)))
    .sort((a, b) => b.item.publishedAt.localeCompare(a.item.publishedAt))[0] ?? null;
}
