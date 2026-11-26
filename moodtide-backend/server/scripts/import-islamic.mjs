#!/usr/bin/env node
// =====================================================================
// MoodTide: import Islamic content (naat, hamd, qasida, darood, kalam, manqabat, nasheed,
// devotional qawwali) from YouTube into the Islamic section (PostgreSQL).
//
// Put this file in:  moodtide-backend/server/scripts/import-islamic.mjs
// Run it from:       moodtide-backend/server
// The Islamic categories (gen_isl_*) are created by this script if they do not exist yet.
//
//   node scripts/import-islamic.mjs --dry-run         (search + match, saves nothing, needs no database)
//   node scripts/import-islamic.mjs                   (save)
//   node scripts/import-islamic.mjs --only naat       (one category: naat hamd qasida darood kalam manqabat nasheed qawwali)
//   node scripts/import-islamic.mjs --per-query 20 --no-artists
//   node scripts/import-islamic.mjs --fresh           (ignore the saved search results)
//
// .env needs: YOUTUBE_API_KEY and the DB_* settings (or DATABASE_URL), same as the server.
// Shared code lives in scripts/lib/ (task A15): flags, cache, YouTube client, duplicate detection, saving.
//
// QUOTA: one YouTube search = 100 units (free limit 10,000/day). The plan is printed first.
// Search results are cached for 7 days (same cache file as import-catalog.mjs and import-youtube.mjs).
// Running it twice never creates duplicates. An item that is already saved as music is left alone.
// Videos play through the official YouTube embedded player. No audio is downloaded.
// =====================================================================
import 'dotenv/config';
import { withTx, ensureGenre, runScript } from './lib/db.js';
import { getFlags } from './lib/flags.js';
import { createYouTube, isUsableVideo } from './lib/youtube.js';
import { loadCatalogIndex } from './lib/dedupe.js';
import { saveSong } from './lib/save.js';
import { isBadVideo } from './lib/filters.js';
import { norm, dupKey, isoToSec, cleanTitleIslamic as cleanTitle, cleanChannel } from './lib/normalize.js';
import { clamp, round3, warn, unit, popularityFromViews } from './lib/util.js';

// ---------- command line ----------
const { has, opt, dryRun: DRY_RUN, fresh: FRESH } = getFlags();
const PER_QUERY = Math.max(1, parseInt(opt('per-query', '15'), 10) || 15);
const NO_ARTISTS = has('no-artists');
const ONLY = String(opt('only', '')).toLowerCase();
const YT_REGION = String(opt('region', 'PK')).toUpperCase();
const YT_KEY = opt('key', process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || '');
const MIN_SEC = 60, MAX_SEC = 1200; // darood and qasida are often longer than songs

// ---------- categories ----------
// key -> genre id/name, and a pattern that recognises it in a video title
const CATS = {
  naat:     { id: 'gen_isl_naat',     name: 'Naat',     re: /na['’]?at/i },
  hamd:     { id: 'gen_isl_hamd',     name: 'Hamd',     re: /\bhamd/i },
  qasida:   { id: 'gen_isl_qasida',   name: 'Qasida',   re: /qasid|qaseed|burda|tala['’]?\s?al\s?badru/i },
  darood:   { id: 'gen_isl_darood',   name: 'Darood',   re: /d[au]r+o+d|salawat/i },
  kalam:    { id: 'gen_isl_kalam',    name: 'Kalam',    re: /\bkalam\b|kalaam/i },
  manqabat: { id: 'gen_isl_manqabat', name: 'Manqabat', re: /manqabat|manqibat/i },
  nasheed:  { id: 'gen_isl_nasheed',  name: 'Nasheed',  re: /nasheed|anasheed|nashid/i },
  qawwali:  { id: 'gen_isl_qawwali',  name: 'Qawwali',  re: /qawwali|qawali/i },
};
// first match wins, most specific first
const CLASSIFY_ORDER = ['manqabat', 'hamd', 'qasida', 'darood', 'nasheed', 'kalam', 'qawwali', 'naat'];

// a result must look religious, otherwise a search for "kalam e" returns unrelated videos
const RELIGIOUS = /na['’]?at|\bhamd|qasid|qaseed|burda|d[au]r+o+d|salawat|\bkalam|kalaam|manqabat|nasheed|qawwali|rasool|rasul|muhammad|madina|mustafa|allah|islamic|sufi|ya nabi|sarkar|tajdar|haram/i;
// What to search. [text, default category]
const QUERIES = [
  ['naat sharif', 'naat'], ['naat e rasool new', 'naat'], ['urdu naat sharif', 'naat'],
  ['hamd e bari taala', 'hamd'], ['hamd urdu', 'hamd'],
  ['qasida burda sharif', 'qasida'], ['tala al badru alayna', 'qasida'], ['qaseeda', 'qasida'],
  ['darood sharif', 'darood'], ['durood e ibrahimi', 'darood'], ['salawat on prophet', 'darood'],
  ['kalam e', 'kalam'], ['sufi kalam', 'kalam'],
  ['manqabat', 'manqabat'],
  ['islamic nasheed', 'nasheed'], ['nasheed', 'nasheed'],
  ['devotional qawwali', 'qawwali'], ['sufi qawwali', 'qawwali'],
];
// Artists known for this kind of content. [name, region]
const ARTISTS = [
  ['Owais Raza Qadri', 'pakistani'], ['Junaid Jamshed', 'pakistani'], ['Khalid Hasnain Khalid', 'pakistani'],
  ['Hafiz Tahir Qadri', 'pakistani'], ['Syed Fasihuddin Soharwardi', 'pakistani'], ['Siddique Ismail', 'pakistani'],
  ['Amjad Sabri', 'pakistani'], ['Sabri Brothers', 'pakistani'],
  ['Sami Yusuf', 'international'], ['Maher Zain', 'international'],
];

// ---------- helpers ----------
const classify = (text, fallback) => CLASSIFY_ORDER.find((k) => CATS[k].re.test(text)) || fallback;

// neutral, quiet features (the Islamic section is not used by mood matching, but the table needs numbers)
const featuresFor = (id) => {
  const u = (s) => unit(id + s) - 0.5;
  return {
    energy: round3(clamp(0.25 + u('e') * 0.1, 0, 1)), happiness: round3(clamp(0.5 + u('h') * 0.1, 0, 1)),
    tempo: Math.round(clamp(80 + u('t') * 20, 40, 220)), danceability: round3(clamp(0.15 + u('d') * 0.1, 0, 1)),
    acousticness: round3(clamp(0.8 + u('a') * 0.1, 0, 1)),
  };
};

// ---------- main ----------
async function main() {
  if (!YT_KEY) { console.error('No YouTube key. Put YOUTUBE_API_KEY in .env.'); process.exit(1); }

  let items = QUERIES.map(([q, cat]) => ({ q, cat, artist: null, region: 'international' }));
  if (!NO_ARTISTS) items = items.concat(ARTISTS.map(([name, region]) => ({ q: `${name} naat`, cat: 'naat', artist: name, region })));
  if (ONLY) {
    if (!CATS[ONLY]) { console.error(`--only must be one of: ${Object.keys(CATS).join(', ')}`); process.exit(1); }
    items = items.filter((i) => i.cat === ONLY);
  }

  const yt = createYouTube({ key: YT_KEY, fresh: FRESH });
  console.log(`${items.length} searches, at most about ${items.length * 100} YouTube units (searches saved in the cache cost nothing).${DRY_RUN ? '  (dry run: nothing is saved)' : ''}\n`);

  // ----- 1) search -----
  const found = []; // { item, list }
  for (const item of items) {
    if (yt.quotaHit) { warn('YouTube quota is used up, stopping early'); break; }
    try { found.push({ item, list: await yt.search(item.q, { cacheKey: `islamic:${item.q}` }) }); }
    catch (e) { warn(`search "${item.q}": ${e.message}`); }
  }
  const allIds = [...new Set(found.flatMap((f) => f.list.map((v) => v.id)))];
  console.log(`Checking ${allIds.length} videos (length, embeddable, region)...`);
  const details = await yt.details(allIds);

  // ----- 2) pick -----
  const catalog = new Map(); // videoId -> record
  const seenKey = new Set();
  for (const { item, list } of found) {
    let kept = 0;
    for (const v of list) {
      if (kept >= PER_QUERY) break;
      const d = details.get(v.id);
      if (!d || !isUsableVideo(d, { minSec: MIN_SEC, maxSec: MAX_SEC, region: YT_REGION }) || catalog.has(v.id)) continue;
      const text = `${v.title} ${v.channel}`;
      if (isBadVideo(v.title, { profile: 'islamic' }) || !RELIGIOUS.test(text)) continue;
      if (item.artist && !norm(text).includes(norm(item.artist))) continue;
      const title = cleanTitle(v.title);
      const artist = item.artist || cleanChannel(v.channel);
      if (!title || title.length < 2) continue;
      const key = dupKey(artist, title);
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      const views = Number(d.statistics?.viewCount) || 0;
      const year = parseInt(String(d.snippet.publishedAt || '').slice(0, 4), 10);
      catalog.set(v.id, {
        id: v.id, title, artist, region: item.region, cat: classify(text, item.cat),
        sec: isoToSec(d.contentDetails.duration), views, popularity: popularityFromViews(views),
        year: year >= 1900 && year <= 2100 ? year : null,
        thumb: (d.snippet.thumbnails?.high || d.snippet.thumbnails?.medium || d.snippet.thumbnails?.default || {}).url || null,
      });
      kept++;
    }
    console.log(`${(item.artist || item.q).padEnd(30)} kept ${String(kept).padStart(2)}`);
  }

  const records = [...catalog.values()];
  const byCat = {};
  for (const r of records) byCat[CATS[r.cat].name] = (byCat[CATS[r.cat].name] || 0) + 1;
  console.log(`\nIslamic items ready: ${records.length}  by category: ${JSON.stringify(byCat)}   (YouTube units used: about ${yt.units})`);
  if (DRY_RUN) {
    for (const r of records.slice(0, 15)) console.log(`  [${CATS[r.cat].name}] ${r.artist} - ${r.title} (${Math.round(r.sec / 60)} min)`);
    return;
  }
  if (!records.length) { console.error('Nothing found, so nothing was saved.'); process.exitCode = 1; return; }

  // ----- 3) save (shared saveSong: no duplicates on a second run) -----
  const result = await withTx(async (tx) => {
    // the category genres are not in the seed: create the ones that are used (name taken by a music genre -> "Qawwali (Islamic)")
    for (const key of new Set(records.map((r) => r.cat))) {
      await ensureGenre(tx, { id: CATS[key].id, name: CATS[key].name, altName: `${CATS[key].name} (Islamic)` });
    }
    const index = await loadCatalogIndex(tx);
    const counts = { inserted: 0, updated: 0, duplicate: 0, skipped: 0 };
    for (const t of records) {
      const link = `https://www.youtube.com/watch?v=${t.id}`;
      const out = await saveSong(tx, index, {
        source: 'youtube', externalId: t.id, title: t.title, durationSec: t.sec, year: t.year,
        artist: { name: t.artist, country: null },
        album: { title: t.title, cover: t.thumb },
        audioUrl: null, popularity: t.popularity, contentType: 'islamic', region: t.region,
        sourceUrl: link, externalUrl: link,
        features: featuresFor(t.id), featureSource: 'estimated', genreIds: [CATS[t.cat].id],
      });
      counts[out.action] = (counts[out.action] || 0) + 1;
    }
    return counts;
  });
  console.log(`\nSaved ${result.inserted} new Islamic items, updated ${result.updated} existing ones` +
    `${result.duplicate + result.skipped ? `, left ${result.duplicate + result.skipped} alone (already saved as the same song, or as music)` : ''}.`);
  if (yt.quotaHit) console.log('Note: the YouTube quota ran out, so some searches were skipped. Run again tomorrow.');
}

runScript(main);
