// Task A35: choose videos for a thin music category straight from YouTube search results
// (without iTunes matching, which finds few qawwali, ghazal and sufi recordings).
import { isUsableVideo } from './youtube.js';
import { isBadVideo } from './filters.js';
import { cleanTitle, hasWords, dupKey, isoToSec } from './normalize.js';

export const TOPUP_QUERIES = {
  qawwali: ['nusrat fateh ali khan qawwali', 'sabri brothers qawwali', 'aziz mian qawwali', 'fareed ayaz qawwali', 'amjad sabri qawwali'],
  sufi: ['abida parveen sufi kalam', 'sanam marvi sufi kalam', 'sain zahoor kalam'],
  ghazal: ['mehdi hassan ghazal', 'jagjit singh ghazal'],
};

const MIN_SEC = 90, MAX_SEC = 1800; // qawwali recordings are long
const COMPILATION = /juke ?box|non[ -]?stop|collection|best of|all songs|top \d+|mash ?up|\bvol(ume)?\b|playlist|audio songs/i;

/**
 * Keep videos that name one of the category's artists (title or channel), are playable here
 * and are single recordings. `artists` is a GENRE_ARTISTS list: [name, region, country].
 */
export function pickVideos(list, details, { artists, region = 'PK', limit = 30, seen = new Set() }) {
  const out = [];
  for (const v of list) {
    if (out.length >= limit) break;
    const d = details.get(v.id);
    if (!d || seen.has(v.id) || !isUsableVideo(d, { minSec: MIN_SEC, maxSec: MAX_SEC, region })) continue;
    if (COMPILATION.test(v.title) || isBadVideo(v.title, { profile: 'music' })) continue;
    const hit = artists.find(([name]) => hasWords(`${v.title} ${v.channel}`, name));
    if (!hit) continue;
    const title = cleanTitle(v.title);
    if (title.length < 3) continue;
    const key = dupKey(hit[0], title);
    if (seen.has(key)) continue;
    seen.add(v.id);
    seen.add(key);
    out.push({
      videoId: v.id, title, artist: hit[0], region: hit[1], country: hit[2],
      sec: isoToSec(d.contentDetails.duration), views: Number(d.statistics?.viewCount) || 0,
      cover: d.snippet?.thumbnails?.high?.url || d.snippet?.thumbnails?.default?.url || null,
    });
  }
  return out;
}
