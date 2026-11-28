#!/usr/bin/env node
// =====================================================================
// MoodTide A35: top up a thin music category from YouTube.
//
// Run it from moodtide-backend/server:
//   node scripts/import-topup.mjs --genre qawwali,sufi,ghazal --dry-run
//   node scripts/import-topup.mjs --genre qawwali,sufi,ghazal
//
// Flags: --per-query 30   --searches 2 (use only the first 2 searches of each category)   --region PK
// Each search counts once against the daily search limit and is cached for 7 days.
// Only videos naming an artist of that category (scripts/lib/artists.js) are kept.
// Features are estimates (feature_source 'estimated'). A second run creates no duplicates.
// =====================================================================
import 'dotenv/config';
import { withTx, runScript } from './lib/db.js';
import { getFlags } from './lib/flags.js';
import { createYouTube } from './lib/youtube.js';
import { loadCatalogIndex } from './lib/dedupe.js';
import { saveSong } from './lib/save.js';
import { GENRE_IDS, GENRE_ARTISTS } from './lib/artists.js';
import { TOPUP_QUERIES, pickVideos } from './lib/topup.js';
import { clamp, round3, jitter, warn, popularityFromViews } from './lib/util.js';

const { opt, int, dryRun: DRY_RUN, fresh } = getFlags();
const GENRES = String(opt('genre', '')).toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
const PER_QUERY = int('per-query', 30, 1, 50);
const SEARCHES = int('searches', 10, 1, 10);
const REGION = String(opt('region', 'PK')).toUpperCase();
const KEY = opt('key', process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || '');

// starting estimates: energy, happiness, danceability, acousticness, tempo
const PROFILE = { qawwali: [0.68, 0.55, 0.45, 0.7, 110], sufi: [0.42, 0.42, 0.35, 0.8, 88], ghazal: [0.28, 0.32, 0.3, 0.85, 76] };
const features = (genre, id) => {
  const [e, h, d, a, t] = PROFILE[genre];
  const n = (v, k, amount) => round3(clamp(v + jitter(id + k, amount), 0, 1));
  return { energy: n(e, 'e', 0.08), happiness: n(h, 'h', 0.1), danceability: n(d, 'd', 0.08), acousticness: n(a, 'a', 0.08),
    tempo: Math.round(clamp(t + jitter(id + 't', 10), 40, 220)) };
};

async function main() {
  if (!KEY) throw new Error('No YouTube key. Put YOUTUBE_API_KEY in .env.');
  if (!GENRES.length || GENRES.some((g) => !TOPUP_QUERIES[g])) throw new Error(`Use --genre with: ${Object.keys(TOPUP_QUERIES).join(', ')}`);
  const yt = createYouTube({ key: KEY, fresh });
  const seen = new Set();
  for (const genre of GENRES) {
    const records = [];
    for (const q of TOPUP_QUERIES[genre].slice(0, SEARCHES)) {
      if (yt.quotaHit) break;
      try {
        const list = await yt.search(q, { extra: { videoCategoryId: '10' }, cacheKey: `topup:${q}` });
        const details = await yt.details(list.map((v) => v.id));
        const picked = pickVideos(list, details, { artists: GENRE_ARTISTS[genre], region: REGION, limit: PER_QUERY, seen });
        console.log(`${q.padEnd(34)} kept ${picked.length}`);
        records.push(...picked);
      } catch (e) { warn(`search "${q}": ${e.message}`); }
    }
    if (DRY_RUN) {
      for (const r of records.slice(0, 8)) console.log(`  ${r.artist} - ${r.title} (${Math.round(r.sec / 60)} min)`);
      console.log(`${genre}: ${records.length} ready (dry run: nothing saved)\n`);
      continue;
    }
    const counts = await withTx(async (tx) => {
      const index = await loadCatalogIndex(tx);
      const c = { inserted: 0, updated: 0, duplicate: 0, skipped: 0 };
      for (const r of records) {
        const link = `https://www.youtube.com/watch?v=${r.videoId}`;
        const out = await saveSong(tx, index, {
          source: 'youtube', externalId: r.videoId, title: r.title, durationSec: r.sec,
          artist: { name: r.artist, country: r.country }, album: { title: r.title, cover: r.cover },
          audioUrl: null, popularity: popularityFromViews(r.views), contentType: 'music', region: r.region,
          sourceUrl: link, externalUrl: link, features: features(genre, r.videoId), genreIds: [GENRE_IDS[genre]],
        });
        c[out.action]++;
      }
      return c;
    });
    console.log(`${genre}: saved ${counts.inserted} new, ${counts.updated} already saved, ${counts.duplicate + counts.skipped} left alone\n`);
  }
  if (yt.quotaHit) console.log('The daily search limit is used up. Run the same command again after the reset.');
}

runScript(main);
