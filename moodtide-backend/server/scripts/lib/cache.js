// A small JSON cache on disk, so a dry run followed by the real run costs API quota only once.
//   const cache = createCache('.yt-search-cache.json', { days: 7 });
//   const hit = cache.get(key);  cache.set(key, data);
// The file sits in the scripts/ folder (git-ignored). The file names of the old importers are kept,
// so a cache you already have keeps working.
import { readFileSync, writeFileSync } from 'node:fs';

export function createCache(fileName, { days = 7 } = {}) {
  const file = new URL(`../${fileName}`, import.meta.url);
  let data = {};
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* no cache yet */ }
  return {
    get(key, { fresh = false } = {}) {
      const hit = data[key];
      if (fresh || !hit || Date.now() - hit.t > days * 86400000) return undefined;
      return hit.data ?? hit.list;   // older files stored the YouTube list under "list"
    },
    set(key, value) {
      data[key] = { t: Date.now(), data: value };
      try { writeFileSync(file, JSON.stringify(data)); } catch { /* the cache is optional */ }
    },
  };
}
