#!/usr/bin/env node
// =====================================================================
// MoodTide: import real songs from the YouTube Data API v3 into PostgreSQL.
//
// Put this file in:  moodtide-backend/server/scripts/import-youtube.mjs
// Run it from:       moodtide-backend/server
//
//   node scripts/import-youtube.mjs                     (25 songs per genre)
//   node scripts/import-youtube.mjs --per-genre 40 --per-artist 8
//   node scripts/import-youtube.mjs --dry-run           (searches, but saves nothing)
//   node scripts/import-youtube.mjs --no-pakistani      (skip the Pakistani artist list, saves quota)
//   node scripts/import-youtube.mjs --region PK         (hide videos blocked in this country)
//   node scripts/import-youtube.mjs --key YOUR_KEY      (or put YOUTUBE_API_KEY in .env)
//   node scripts/import-youtube.mjs --fresh             (ignore the saved search results)
//   node scripts/import-youtube.mjs --deactivate-demo   (hides songs with source = 'demo')
//
// Uses the same .env as the backend (DB_* settings or DATABASE_URL) plus YOUTUBE_API_KEY.
// Shared code lives in scripts/lib/ (task A15): flags, cache, YouTube client, duplicate detection, saving.
//
// QUOTA: the free limit is 10,000 units per day. One search costs 100 units, one details request
// costs 1 unit. Search results are cached for 7 days (scripts/.yt-search-cache.json), so a repeated
// search costs nothing. The script prints its plan before it starts.
//
// Running it twice never creates duplicates: a song is matched by (source, video id) and by
// normalised artist + title.
//
// NOTE: YouTube gives no energy / happiness / tempo numbers, so those are estimated from the genre.
// Songs are saved with a link to YouTube (external_url, source_url) and the video id (external_id),
// with feature_source = 'estimated'. Play them with the official YouTube embedded player.
// Do not download audio from YouTube.
// =====================================================================
import 'dotenv/config';
import { query, withTx, ensureGenre, runScript } from './lib/db.js';
import { getFlags } from './lib/flags.js';
import { createYouTube, isUsableVideo } from './lib/youtube.js';
import { loadCatalogIndex } from './lib/dedupe.js';
import { saveSong } from './lib/save.js';
import { isBadVideo } from './lib/filters.js';
import { norm, dupKey, isoToSec, cleanTitle, parseArtistTitle, interleave } from './lib/normalize.js';
import { clamp, round3, jitter, warn, popularityFromViews } from './lib/util.js';

// Kept so tests (and older scripts) can still import these helpers from here
export { isoToSec, cleanTitle, parseArtistTitle, interleave };

// ---------- command line ----------
const { has, opt, dryRun: DRY_RUN, fresh: FRESH } = getFlags();
const PER_GENRE = Math.max(1, parseInt(opt('per-genre', '25'), 10) || 25);
const PER_ARTIST = Math.max(1, parseInt(opt('per-artist', '6'), 10) || 6);
const NO_PAKISTANI = has('no-pakistani');
const DEACTIVATE_DEMO = has('deactivate-demo');
const REGION = String(opt('region', 'PK')).toUpperCase();
const API_KEY = opt('key', process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || process.env.GOOGLE_API_KEY || '');
const MIN_SEC = 45;   // shorter than this is not a song
const MAX_SEC = 900;  // longer than 15 minutes is usually a mix or a full album

// ---------- what to search for ----------
// "profile" = rough guess of the song features for that style (0-1, tempo in BPM).
// e = energy, h = happiness, d = danceability, a = acousticness, t = tempo.
const NEUTRAL = { e: 0.5, h: 0.5, d: 0.5, a: 0.4, t: 100 };

// Each entry is matched against the genre names already in YOUR genres table. First match wins.
const GENRE_PLAN = [
  { match: /dream/i,                   queries: ['dream pop', 'shoegaze dream pop'],             profile: { e: 0.35, h: 0.5,  d: 0.4,  a: 0.3,  t: 95 } },
  { match: /neo|cinematic/i,           queries: ['neoclassical piano', 'cinematic piano'],       profile: { e: 0.25, h: 0.4,  d: 0.2,  a: 0.9,  t: 70 } },
  { match: /techno|house|melodic/i,    queries: ['melodic techno', 'deep house'],                profile: { e: 0.8,  h: 0.55, d: 0.78, a: 0.05, t: 122 } },
  { match: /synth|retro|wave/i,        queries: ['synthwave', 'retrowave', 'outrun'],            profile: { e: 0.75, h: 0.5,  d: 0.62, a: 0.05, t: 118 } },
  { match: /lo-?fi|chill/i,            queries: ['lofi hip hop', 'chillhop'],                    profile: { e: 0.3,  h: 0.5,  d: 0.55, a: 0.35, t: 80 } },
  { match: /ambient|drone|relax|sleep/i, queries: ['ambient', 'dark ambient drone'],             profile: { e: 0.15, h: 0.35, d: 0.2,  a: 0.55, t: 65 } },
  { match: /classical|orchestra/i,     queries: ['classical piano', 'relaxing classical'],       profile: { e: 0.2,  h: 0.4,  d: 0.2,  a: 0.95, t: 72 } },
  { match: /jazz|blues/i,              queries: ['smooth jazz', 'jazz classics'],                profile: { e: 0.35, h: 0.55, d: 0.5,  a: 0.75, t: 100 } },
  { match: /acoustic|folk|indie/i,     queries: ['indie folk', 'acoustic song'],                 profile: { e: 0.35, h: 0.55, d: 0.4,  a: 0.85, t: 95 } },
  { match: /hip|rap|trap/i,            queries: ['hip hop hits', 'rap'],                         profile: { e: 0.75, h: 0.55, d: 0.78, a: 0.1,  t: 95 } },
  { match: /r&b|rnb|soul/i,            queries: ['r&b', 'neo soul'],                             profile: { e: 0.5,  h: 0.6,  d: 0.7,  a: 0.3,  t: 100 } },
  { match: /electro|edm|dance/i,       queries: ['electronic dance', 'edm hits'],                profile: { e: 0.85, h: 0.65, d: 0.8,  a: 0.05, t: 126 } },
  { match: /rock|metal|punk|alt/i,     queries: ['rock classics', 'alternative rock'],           profile: { e: 0.8,  h: 0.55, d: 0.5,  a: 0.15, t: 124 } },
  { match: /pop/i,                     queries: ['pop hits', 'feel good pop'],                   profile: { e: 0.7,  h: 0.75, d: 0.72, a: 0.15, t: 115 } },
  { match: /country/i,                 queries: ['country hits'],                                profile: { e: 0.55, h: 0.65, d: 0.55, a: 0.6,  t: 105 } },
  { match: /reggae/i,                  queries: ['reggae'],                                      profile: { e: 0.5,  h: 0.75, d: 0.7,  a: 0.35, t: 90 } },
  { match: /latin/i,                   queries: ['latin pop', 'reggaeton'],                      profile: { e: 0.75, h: 0.8,  d: 0.8,  a: 0.2,  t: 100 } },
];

// Pakistani artists, searched by name. Songs get the "Pakistani" genre and country PK.
const STYLE = {
  qawwali: { e: 0.65, h: 0.55, d: 0.5,  a: 0.8,  t: 105 },
  sufi:    { e: 0.4,  h: 0.45, d: 0.35, a: 0.85, t: 85 },
  ghazal:  { e: 0.2,  h: 0.3,  d: 0.2,  a: 0.9,  t: 70 },
  pop:     { e: 0.65, h: 0.65, d: 0.65, a: 0.3,  t: 108 },
  rock:    { e: 0.8,  h: 0.55, d: 0.5,  a: 0.2,  t: 120 },
  hiphop:  { e: 0.8,  h: 0.55, d: 0.8,  a: 0.1,  t: 95 },
};
const PAKISTANI_ARTISTS = [
  ['Nusrat Fateh Ali Khan', 'qawwali'], ['Rahat Fateh Ali Khan', 'qawwali'], ['Abida Parveen', 'sufi'],
  ['Arooj Aftab', 'sufi'], ['Amjad Sabri', 'qawwali'],
  ['Mehdi Hassan', 'ghazal'], ['Ghulam Ali', 'ghazal'], ['Farida Khanum', 'ghazal'],
  ['Atif Aslam', 'pop'], ['Ali Zafar', 'pop'], ['Asim Azhar', 'pop'], ['Hasan Raheem', 'pop'],
  ['Ali Sethi', 'pop'], ['Momina Mustehsan', 'pop'], ['Quratulain Balouch', 'pop'],
  ['Shiraz Uppal', 'pop'], ['Hadiqa Kiani', 'pop'],
  ['Junoon', 'rock'], ['Strings', 'rock'], ['Fuzon', 'rock'], ['Noori', 'rock'], ['Mekaal Hasan Band', 'rock'],
  ['Talha Anjum', 'hiphop'], ['Faris Shafi', 'hiphop'],
];

// ---------- feature estimation (YouTube gives no energy / happiness / tempo) ----------
const SAD_RE = /\b(sad|cry|crying|tears|alone|lonely|goodbye|broken|lost|pain|dark|rain|miss)\b/i;
const HAPPY_RE = /\b(happy|dance|party|sunshine|joy|smile|summer|celebrate|fun|love)\b/i;
export function estimate(t) {
  const p = t.profile, k = String(t.id);
  let energy = p.e + jitter(k + 'e', 0.12);
  let happy = p.h + jitter(k + 'h', 0.15);
  let dance = p.d + jitter(k + 'd', 0.10);
  const acoustic = p.a + jitter(k + 'a', 0.10);
  if (SAD_RE.test(t.title))   { happy -= 0.2;  energy -= 0.1; }
  if (HAPPY_RE.test(t.title)) { happy += 0.15; energy += 0.05; }
  const tempo = Math.round(clamp(p.t + jitter(k + 't', 15), 40, 220));
  if (tempo >= 100 && tempo <= 130) dance += 0.05;
  return {
    energy: round3(clamp(energy, 0, 1)),
    happiness: round3(clamp(happy, 0, 1)),
    tempo,
    danceability: round3(clamp(dance, 0, 1)),
    acousticness: round3(clamp(acoustic, 0, 1)),
  };
}

// ---------- main ----------
async function main() {
  const yt = createYouTube({ key: API_KEY, fresh: FRESH });
  await yt.checkKey();

  // The Islamic categories (gen_isl_*) have their own importer (import-islamic.mjs)
  const dbGenres = (await query('SELECT genre_id, name FROM genres ORDER BY name')).filter((g) => !g.genre_id.startsWith('gen_isl_'));
  console.log(`Found ${dbGenres.length} music genres in your database: ${dbGenres.map((g) => g.name).join(', ')}`);

  // ----- build the search groups: one per genre, one per Pakistani artist -----
  const groups = [];
  for (const g of dbGenres) {
    const plan = GENRE_PLAN.find((p) => p.match.test(g.name)) || { queries: [g.name], profile: NEUTRAL, fallback: true };
    if (plan.fallback) warn(`no preset for genre "${g.name}", searching for its name with neutral features`);
    groups.push({ label: g.name, genreId: g.genre_id, profile: plan.profile, queries: plan.queries,
      duration: 'short', limit: PER_GENRE, country: null, region: 'international', artist: null, items: [] });
  }
  let pkGenreId = (dbGenres.find((g) => /pakistan|desi/i.test(g.name)) || {}).genre_id;
  let createPkGenre = false;
  if (!NO_PAKISTANI) {
    if (!pkGenreId) { pkGenreId = 'gen_pakistani'; createPkGenre = true; }
    for (const [name, style] of PAKISTANI_ARTISTS) {
      groups.push({ label: name, genreId: pkGenreId, profile: STYLE[style], queries: [name],
        duration: 'any', limit: PER_ARTIST, country: 'PK', region: 'pakistani', artist: name, items: [] });
    }
  }
  const planned = groups.reduce((a, g) => a + g.queries.length * 100, 0);
  console.log(`Plan: ${groups.length} search groups, at most about ${planned} quota units (searches saved in the cache cost nothing; free limit is 10,000 per day).`);
  console.log(DRY_RUN ? '(dry run: searches still use quota, but nothing is saved)\n' : '');

  const search = (q, duration) => yt.search(q, {
    extra: { videoCategoryId: '10', videoDuration: duration }, cacheKey: `yt:${q}|${duration}`,
  });

  // ----- 1) search -----
  for (const grp of groups) {
    if (yt.quotaHit) { warn('quota is used up, stopping the search early'); break; }
    const lists = [];
    for (const q of grp.queries) {
      try { lists.push(await search(q, grp.duration)); }
      catch (e) { warn(`search "${q}": ${e.message}`); lists.push([]); if (yt.quotaHit) break; }
    }
    let items = interleave(lists);
    // too few short videos? try one search for medium-length ones (4-20 minutes)
    if (grp.duration === 'short' && items.length < grp.limit + 5 && !yt.quotaHit) {
      try { items = interleave([items, await search(grp.queries[0], 'medium')]); }
      catch (e) { warn(`search "${grp.queries[0]}" (medium): ${e.message}`); }
    }
    if (grp.artist) {
      const a = norm(grp.artist);
      items = items.filter((it) => norm(`${it.title} ${it.channel}`).includes(a));
    }
    grp.items = items.slice(0, grp.limit * 3); // keep a buffer, some will fail the checks below
    console.log(`${grp.label.padEnd(26)} videos found: ${String(items.length).padStart(3)}`);
  }

  // ----- 2) details + checks -----
  const allIds = [...new Set(groups.flatMap((g) => g.items.map((i) => i.id)))];
  console.log(`\nChecking ${allIds.length} videos (duration, embeddable, region)...`);
  const details = await yt.details(allIds);

  // ----- 3) pick the final songs -----
  const catalog = new Map(); // normalised "artist|title" -> record
  for (const grp of groups) {
    let kept = 0;
    for (const it of grp.items) {
      if (kept >= grp.limit) break;
      const v = details.get(it.id);
      if (!v || !isUsableVideo(v, { minSec: MIN_SEC, maxSec: MAX_SEC, region: REGION })) continue;
      const sn = v.snippet;
      if (isBadVideo(sn.title, { profile: 'genre' })) continue;   // tutorials, covers, karaoke, mashups...
      const p = parseArtistTitle(sn.title, sn.channelTitle);
      const artist = grp.artist || p.artist;
      const title = grp.artist && !norm(p.artist).includes(norm(grp.artist)) ? cleanTitle(sn.title) : p.title;
      if (!title || !artist) continue;
      const key = dupKey(artist, title);
      const existing = catalog.get(key);
      if (existing) { existing.genres.add(grp.genreId); kept++; continue; }
      const year = parseInt(String(sn.publishedAt || '').slice(0, 4), 10);
      catalog.set(key, {
        id: v.id, title, artist, country: grp.country, region: grp.region,
        duration: isoToSec(v.contentDetails.duration),
        popularity: popularityFromViews(v.statistics?.viewCount),
        year: year >= 1900 && year <= 2100 ? year : null,
        thumb: (sn.thumbnails?.high || sn.thumbnails?.medium || sn.thumbnails?.default || {}).url || null,
        genres: new Set([grp.genreId]), profile: grp.profile,
      });
      kept++;
    }
    console.log(`${grp.label.padEnd(26)} kept: ${String(kept).padStart(3)}${kept === 0 ? '  (nothing usable)' : ''}`);
  }

  console.log(`\nTotal unique songs ready: ${catalog.size}   (quota used this run: about ${yt.units} units)`);
  if (DRY_RUN) {
    for (const t of [...catalog.values()].slice(0, 6)) console.log(`  ${t.artist} - ${t.title}  ${JSON.stringify(estimate(t))}`);
    return;
  }
  if (catalog.size === 0) {
    console.error('Nothing found, so nothing was saved. Read the "!" lines above for the reason.');
    process.exitCode = 1;
    return;
  }

  // ----- 4) save everything in one transaction (shared saveSong: no duplicates on a second run) -----
  const result = await withTx(async (tx) => {
    if (createPkGenre && [...catalog.values()].some((t) => t.genres.has(pkGenreId))) {
      await ensureGenre(tx, { id: pkGenreId, name: 'Pakistani' });
    }
    const index = await loadCatalogIndex(tx);
    const counts = { inserted: 0, updated: 0, duplicate: 0, skipped: 0 };
    for (const t of catalog.values()) {
      const link = `https://www.youtube.com/watch?v=${t.id}`;
      const out = await saveSong(tx, index, {
        source: 'youtube', externalId: t.id, title: t.title, durationSec: t.duration, year: t.year,
        artist: { name: t.artist, country: t.country },
        album: { title: t.title, cover: t.thumb },            // YouTube has no albums: a one-song album holds the thumbnail
        audioUrl: null, popularity: t.popularity, contentType: 'music', region: t.region,
        sourceUrl: link, externalUrl: link,
        features: estimate(t), featureSource: 'estimated', genreIds: [...t.genres],
      });
      counts[out.action] = (counts[out.action] || 0) + 1;
    }
    let hidden = 0;
    if (DEACTIVATE_DEMO) {
      hidden = (await query(`UPDATE songs SET is_active = false WHERE source = 'demo' AND is_active RETURNING song_id`, {}, tx)).length;
    }
    return { counts, hidden };
  });
  const c = result.counts;
  console.log(`\nSaved ${c.inserted} new songs, updated ${c.updated} existing ones` +
    `${c.duplicate ? `, skipped ${c.duplicate} that already exist under another id` : ''}.` +
    `${DEACTIVATE_DEMO ? ` Hid ${result.hidden} demo songs.` : ''}`);
  if (yt.quotaHit) console.log('Note: your daily quota ran out during the search, so some genres may have fewer songs. Run again tomorrow to add more.');
}

// MOODTIDE_NO_RUN lets tests import the helper functions without starting the import
if (!process.env.MOODTIDE_NO_RUN) runScript(main);
