// Title and artist normalisation. Used for duplicate detection and for cleaning YouTube titles.
// Unlike the old a-z0-9 version, letters from ANY script are kept (Urdu, Hindi, Korean, Japanese, accents),
// so a title written only in Urdu no longer turns into an empty string.

/** "Beyoncé & Jay-Z" -> "beyonce jay z"   (accents removed, other scripts kept, punctuation = space) */
export const norm = (s) => String(s ?? '')
  .normalize('NFKD').replace(/\p{M}+/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Does `haystack` contain `needle` as whole words? ("IU" is found in "IU - Love Poem" but not in "Liu Jian".) */
export const hasWords = (haystack, needle) => {
  const n = norm(needle);
  return n !== '' && ` ${norm(haystack)} `.includes(` ${n} `);
};

/** "Song (feat. X) - Remastered 2011" -> "song". Used to compare titles. */
export const baseKey = (title) => norm(String(title ?? '').replace(/\s*[(\[].*?[)\]]/g, '').replace(/\s+-\s+.*$/, ''));

/** The key two records share when they are the same song by the same artist. */
export const dupKey = (artist, title) => `${norm(artist)}|${baseKey(title) || norm(title)}`;

/** Whitespace cleanup (Jamendo titles can contain line breaks). */
export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// YouTube sends titles with HTML codes like &amp; and &#39;
export const decodeHtml = (s) => String(s ?? '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

// "(Official Video)", "[Lyrics]", "| Some Channel" and similar noise at the end of a YouTube title
const NOISE = /\s*[(\[{][^)\]}]*(official|video|audio|lyric|visuali[sz]er|\bhd\b|4k|\bmv\b|m\/v|remaster|full song|live)[^)\]}]*[)\]}]/gi;
export function cleanTitle(s) {
  let t = decodeHtml(s).replace(NOISE, '').split(/\s[|｜]\s/)[0];
  t = t.replace(/\s+(official\s+(music\s+)?video|official audio|lyric video|lyrics?)\s*$/i, '');
  return t.replace(/\s{2,}/g, ' ').trim();
}
// Islamic titles also drop "(new)", "(full)" and years in brackets
const NOISE_ISLAMIC = /\s*[(\[{][^)\]}]*(official|video|audio|lyric|visuali[sz]er|\bhd\b|4k|\bmv\b|full|new|latest|\d{4})[^)\]}]*[)\]}]/gi;
export const cleanTitleIslamic = (s) => decodeHtml(s).replace(NOISE_ISLAMIC, '').split(/\s[|｜]\s/)[0].replace(/\s{2,}/g, ' ').trim();

export const cleanChannel = (c) =>
  decodeHtml(c).replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').replace(/\s*Official$/i, '').trim() || 'Unknown artist';

/** "Artist - Song (Official Video)" -> { artist, title }. No dash: the channel name is the artist. */
export function parseArtistTitle(rawTitle, channel) {
  const t = cleanTitle(rawTitle);
  const m = t.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: cleanChannel(channel), title: t };
}

/** "PT3M45S" -> 225 */
export function isoToSec(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

/** Take items from each list in turn, skipping repeats, so one query cannot dominate. */
export function interleave(lists) {
  const out = [], seen = new Set();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      if (i < l.length && !seen.has(l[i].id)) { seen.add(l[i].id); out.push(l[i]); }
    }
  }
  return out;
}
