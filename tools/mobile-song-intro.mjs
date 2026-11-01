// The phone home page's "start with these N songs" line. N is the number of songs js/songs.js
// flags with mobileFeatured, so the sentence can never disagree with the songs actually shown.
const ENGLISH_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export const mobileFeaturedCount = songs => songs.filter(song => song.mobileFeatured === true).length;

export function renderMobileSongIntro(count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Expected at least one mobileFeatured song, got ${count}`);
  const english = ENGLISH_NUMBERS[count] ?? String(count);
  const songWord = count === 1 ? "song" : "songs";
  const pronoun = count === 1 ? "this" : "these";
  const zh = `从这 ${count} 首开始听。`;
  return `<p class="mobile-song-intro" data-zh="${zh}" data-en="Start listening with ${pronoun} ${english} ${songWord}." data-ja="まずは、この${count}曲から。">${zh}</p>`;
}
