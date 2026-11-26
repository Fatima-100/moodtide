// The "bad video" filter: tutorials, covers, karaoke, remixes and loops are not the song.
// Three word lists: 'music' (import-catalog: the video must be the song itself), 'genre' (import-youtube genre searches)
// and 'islamic' (naat, hamd... where remixes and loops are also unwanted).

const WORDS = {
  music: ['tutorial', 'lesson', 'lessons', 'learn to', 'how to', 'karaoke', 'instrumental', 'cover', 'covered',
    'reaction', 'reactions', 'react', 'reacts', 'chord', 'chords', 'tabs', 'slowed', 'reverb', 'sped up', 'nightcore',
    '8d', 'mashup', 'remix', 'jukebox', 'interview', 'behind the scenes', 'making of', 'trailer', 'teaser',
    'full album', 'top \\d+', 'best of'],
  // genre searches (import-youtube): "instrumental", "remix", "slowed" and "reverb" are normal in ambient, lofi and electronic
  genre: ['tutorial', 'lesson', 'lessons', 'learn to', 'how to', 'karaoke', 'cover', 'covered', 'reaction', 'reactions',
    'react', 'reacts', 'chord', 'chords', 'tabs', 'nightcore', '8d', 'mashup', 'jukebox', 'interview', 'behind the scenes',
    'making of', 'trailer', 'teaser', 'full album', 'top \\d+', 'best of'],
  islamic: ['karaoke', 'reaction', 'reactions', 'react', 'reacts', 'remix', 'dj', 'slowed', 'reverb', 'sped up',
    'lofi', 'lo-fi', '8d', 'nightcore', 'status', 'shorts', 'whatsapp', 'trailer', 'teaser', 'interview',
    'full album', 'jukebox', 'compilation', 'top \\d+', 'best of', '\\d+ hours?'],
};
const REGEX = Object.fromEntries(Object.entries(WORDS).map(([k, list]) =>
  [k, new RegExp(`(?<![\\p{L}\\p{N}])(${list.join('|')})(?![\\p{L}\\p{N}])`, 'giu')]));

/**
 * Bad words found in a video's text. `trackTitle` is the real song title: a word that the real title
 * itself contains (a song really called "Remix") is ignored.
 */
export function badVideoWords(text, { profile = 'music', trackTitle = '' } = {}) {
  const found = [...String(text ?? '').matchAll(REGEX[profile])].map((m) => m[0].toLowerCase());
  const real = String(trackTitle ?? '').toLowerCase();
  return found.filter((w) => !real.includes(w));
}
export const isBadVideo = (text, opts) => badVideoWords(text, opts).length > 0;
