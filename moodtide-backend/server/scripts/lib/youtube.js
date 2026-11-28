// YouTube Data API client shared by import-catalog, import-youtube and import-islamic.
// Since June 2026 searches have their own daily limit (default 100 calls); a details request for 50 videos
// costs 1 unit of the separate 10,000-unit limit. The "units" numbers printed by the importers still use the
// old rate of 100 per search: divide by 100 to get the number of searches.
// Search results are cached for 7 days (scripts/.yt-search-cache.json), so repeating a search costs nothing.
import { createCache } from './cache.js';
import { sleep, warn } from './util.js';
import { decodeHtml, isoToSec } from './normalize.js';

const YT = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3';   // override only for tests

/** Can this video be played here? Length, embeddable, public, not live, not blocked in `region`. */
export function isUsableVideo(v, { minSec, maxSec, region = 'PK' }) {
  const sn = v.snippet || {}, cd = v.contentDetails || {}, st = v.status || {};
  const dur = isoToSec(cd.duration);
  if (dur < minSec || dur > maxSec) return false;
  if (st.embeddable === false || (st.privacyStatus && st.privacyStatus !== 'public')) return false;
  if (sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none') return false;
  const rr = cd.regionRestriction;
  if (rr?.blocked?.includes(region)) return false;
  if (rr?.allowed && !rr.allowed.includes(region)) return false;
  return true;
}

export function createYouTube({ key, fresh = false } = {}) {
  const cache = createCache('.yt-search-cache.json', { days: 7 });
  let units = 0, quotaHit = false;

  async function call(path, params, cost) {
    const url = new URL(YT + path);
    for (const [k, v] of Object.entries({ ...params, key })) url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); }
      catch (e) { if (attempt === 2) throw e; await sleep(1000 * (attempt + 1)); continue; }
      const json = await res.json().catch(() => ({}));
      if (res.ok) { units += cost; return json; }
      if (res.status >= 500 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
      const err = json.error || {};
      const reason = err.errors?.[0]?.reason || '';
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || /quota/i.test(err.message || '')) quotaHit = true;
      throw new Error(`YouTube API ${res.status}${reason ? ` (${reason})` : ''}: ${err.message || 'request failed'}`);
    }
  }

  return {
    get units() { return units; },
    get quotaHit() { return quotaHit; },

    /** Stops the script with a clear message when the key is missing or rejected. */
    async checkKey() {
      if (!key) {
        console.error('No YouTube API key found. Add  YOUTUBE_API_KEY=your_key  to moodtide-backend/server/.env  (or use --key YOUR_KEY).');
        process.exit(1);
      }
      try { await call('/videos', { part: 'id', id: 'dQw4w9WgXcQ' }, 1); }
      catch (e) {
        console.error(`YouTube key check failed: ${e.message}`);
        console.error('Check: 1) the key is correct, 2) "YouTube Data API v3" is enabled in your Google Cloud project,');
        console.error('3) the key has no website (HTTP referrer) restriction, because this script runs on your computer, not in a browser.');
        process.exit(1);
      }
    },

    /** One search (100 units, or 0 if cached). `extra` adds API parameters; `cacheKey` makes the cache entry unique. */
    async search(q, { extra = {}, cacheKey = q } = {}) {
      const hit = cache.get(cacheKey, { fresh });
      if (hit) return hit;
      const j = await call('/search', { part: 'snippet', q, type: 'video', videoEmbeddable: 'true', maxResults: 50, ...extra }, 100);
      const list = (j.items || []).filter((i) => i.id?.videoId)
        .map((i) => ({ id: i.id.videoId, title: decodeHtml(i.snippet.title), channel: decodeHtml(i.snippet.channelTitle) }));
      cache.set(cacheKey, list);
      return list;
    },

    /** Length, views, embeddable and region details for many ids (50 per request, 1 unit each). */
    async details(ids) {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 50) {
        try {
          const j = await call('/videos', { part: 'snippet,contentDetails,statistics,status', id: ids.slice(i, i + 50).join(',') }, 1);
          for (const v of j.items || []) out.set(v.id, v);
        } catch (e) { warn(`details request failed: ${e.message}`); }
      }
      return out;
    },
  };
}
