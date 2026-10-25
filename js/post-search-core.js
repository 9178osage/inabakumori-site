// Pure search helpers shared by the browser (search.html) and the Node tests.
// Folding: NFKC (full/half width), lower case, katakana → hiragana, whitespace removed.
// Each folded character keeps the index of its source character so matches can be
// highlighted in the original text without ever parsing it as HTML.
(() => {
  const SPACE = /[\s\u200b-\u200d\u2060\ufeff]/u;
  const VOICE = /^[\uff9e\uff9f\u3099\u309a]$/u;
  function foldChar(value) {
    let folded = value.normalize("NFKC").toLowerCase();
    folded = folded.replace(/[\u30a1-\u30f6]/gu, character => String.fromCharCode(character.charCodeAt(0) - 0x60));
    return folded.normalize("NFC");
  }
  function fold(source) {
    const input = String(source ?? "");
    const characters = Array.from(input);
    let text = "";
    const map = [];
    let offset = 0;
    for (let index = 0; index < characters.length; index++) {
      let unit = characters[index];
      const start = offset;
      offset += unit.length;
      // Half-width voiced marks belong to the preceding kana (ｶﾞ → が).
      while (index + 1 < characters.length && VOICE.test(characters[index + 1])) {
        unit += characters[++index];
        offset += characters[index].length;
      }
      if (SPACE.test(unit)) continue;
      const folded = foldChar(unit);
      for (const piece of folded) {
        if (SPACE.test(piece)) continue;
        text += piece;
        for (let i = 0; i < piece.length; i++) map.push([start, offset]);
      }
    }
    return { text, map };
  }
  const foldText = source => fold(source).text;
  function terms(query) {
    return [...new Set(String(query ?? "").split(/[\s\u3000]+/u).map(foldText).filter(Boolean))].slice(0, 8);
  }
  // Ranges (in source string offsets) where every term occurs; null when a term is missing.
  function findRanges(folded, queryTerms) {
    const ranges = [];
    for (const term of queryTerms) {
      let at = folded.text.indexOf(term);
      if (at < 0) return null;
      while (at >= 0 && ranges.length < 50) {
        ranges.push([folded.map[at][0], folded.map[at + term.length - 1][1]]);
        at = folded.text.indexOf(term, at + term.length);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    return merged;
  }
  // [{ text, mark }] pieces; callers render them with textContent only.
  function segments(source, ranges) {
    const value = String(source ?? "");
    const pieces = [];
    let cursor = 0;
    for (const [start, end] of ranges || []) {
      if (start > cursor) pieces.push({ text: value.slice(cursor, start), mark: false });
      pieces.push({ text: value.slice(start, end), mark: true });
      cursor = end;
    }
    if (cursor < value.length) pieces.push({ text: value.slice(cursor), mark: false });
    return pieces;
  }
  const FIELDS = ["text", "zh", "en"];
  // Records: [id, creatorIndex, publishedAt, text, zh, en] as written by tools/post-search-index.mjs.
  function prepare(records) {
    return records.map(record => ({
      id: record[0], creator: record[1] === 1 ? "nknk" : "inabakumori", publishedAt: record[2],
      text: record[3], zh: record[4] || "", en: record[5] || "",
      folded: { text: fold(record[3]), zh: fold(record[4] || ""), en: fold(record[5] || "") }
    }));
  }
  function search(posts, query, { creator = "all", year = "all", limit = Infinity } = {}) {
    const queryTerms = terms(query);
    if (!queryTerms.length) return [];
    const results = [];
    for (const post of posts) {
      if (creator !== "all" && post.creator !== creator) continue;
      // Years follow Japan time, matching the per-year index chunks.
      if (year !== "all" && new Date(Date.parse(post.publishedAt) + 32_400_000).toISOString().slice(0, 4) !== year) continue;
      const matches = {};
      for (const field of FIELDS) {
        const ranges = findRanges(post.folded[field], queryTerms);
        if (ranges) matches[field] = ranges;
      }
      if (!Object.keys(matches).length) continue;
      results.push({ post, matches, fields: FIELDS.filter(field => matches[field]) });
    }
    results.sort((a, b) => (a.post.publishedAt < b.post.publishedAt ? 1 : a.post.publishedAt > b.post.publishedAt ? -1 : 0));
    return results.slice(0, limit);
  }
  const api = Object.freeze({ fold, foldText, terms, findRanges, segments, prepare, search, FIELDS });
  // eslint-disable-next-line no-undef -- CommonJS export for the build tools and tests.
  if (typeof module === "object" && module.exports) module.exports = api;
  else window.postSearchCore = api;
})();
