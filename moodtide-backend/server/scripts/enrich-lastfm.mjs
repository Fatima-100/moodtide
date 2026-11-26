#!/usr/bin/env node
// =====================================================================
// MoodTide A14: Last.fm tags for every song + the Pakistan top-tracks chart.
// Put this file in:  moodtide-backend/server/scripts/enrich-lastfm.mjs
// Run it from:       moodtide-backend/server      (run db/init/02_tags.sql once first)
//
//   node scripts/enrich-lastfm.mjs --dry-run --limit 20    (small test, saves nothing)
//   node scripts/enrich-lastfm.mjs                         (all songs + chart)
//   node scripts/enrich-lastfm.mjs --chart-only            (refresh only the chart)
//   node scripts/enrich-lastfm.mjs --tags-only --source jamendo
//   node scripts/enrich-lastfm.mjs --jamendo-fallback      (fill songs with < 3 tags from the Jamendo cache)
//   node scripts/enrich-lastfm.mjs --fresh                 (ignore saved responses)
//   Also: --max-requests 3000
//
// .env needs: LASTFM_API_KEY and the DB_* settings (or DATABASE_URL).
// Responses are saved for 7 days in scripts/.lastfm-cache.json.
// =====================================================================
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { query, withTx, closePool } from '../src/db.js';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const intOpt = (n, d, lo, hi) => {
  const v = parseInt(opt(n, String(d)), 10);
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : d));
};

const DRY_RUN = has('dry-run');
const LIMIT = intOpt('limit', 100000, 1, 100000);
const MAX_REQUESTS = intOpt('max-requests', 3000, 1, 100000);
const SOURCE = String(opt('source', '')).trim().toLowerCase() || null;
const FRESH = has('fresh');
const CHART_ONLY = has('chart-only');
const TAGS_ONLY = has('tags-only');
const JAM_FALLBACK = has('jamendo-fallback');

const API_KEY = String(process.env.LASTFM_API_KEY || '').trim();
const API = process.env.LASTFM_API_BASE || 'https://ws.audioscrobbler.com/2.0/'; // override only for tests
const DELAY_MS = 300;      // under 5 requests per second
const CACHE_DAYS = 7;
const TOP = 5;             // tags stored per song
const NEED = 3;            // the task's "done when" threshold
const COUNTRY = 'Pakistan';
const JAM_WEIGHT = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const warn = (m) => console.warn(`  ! ${m}`);
const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []);

// ---------- tags ----------
const SYNONYMS = {
  sufism: 'sufi', 'sufi music': 'sufi',
  'hip hop': 'hip-hop', hiphop: 'hip-hop',
  lofi: 'lo-fi', 'lo fi': 'lo-fi',
  'chill out': 'chill', 'chill-out': 'chill', chillout: 'chill',
  relax: 'relaxing', relaxation: 'relaxing',
  'singer songwriter': 'singer-songwriter', singersongwriter: 'singer-songwriter',
  rnb: 'r&b', 'r and b': 'r&b',
  electronica: 'electronic', electro: 'electronic',
  melancholy: 'melancholic',
  qawali: 'qawwali', qawaali: 'qawwali', qawwalis: 'qawwali',
  ghazals: 'ghazal', gazal: 'ghazal', naats: 'naat', nasheeds: 'nasheed',
  kpop: 'k-pop', 'k pop': 'k-pop', jpop: 'j-pop', 'j pop': 'j-pop',
  pakistan: 'pakistani',
};
// Tags that say something about the listener, not the music
const JUNK = /^(seen live|favou?rites?( songs?| tracks?)?|my .*|love at first listen|awesome|amazing|good|best|cool|spotify|jamendo|youtube|check out|under \d+ listeners|all)$/;
function normTag(raw, artist) {
  let t = clean(raw).toLowerCase().replace(/_/g, ' ').replace(/^#/, '');
  t = SYNONYMS[t] || t;
  if (t.length < 2 || t.length > 40 || JUNK.test(t) || t === clean(artist).toLowerCase()) return null;
  return t;
}
/** merge synonyms (keep the highest count), strongest first */
function topTags(list, artist) {
  const m = new Map();
  for (const x of list) {
    const tag = normTag(x?.name, artist);
    const weight = Math.round(Number(x?.count) || 0);
    if (!tag || weight < 1) continue;
    m.set(tag, Math.max(m.get(tag) || 0, weight));
  }
  return [...m].map(([tag, weight]) => ({ tag, weight })).sort((a, b) => b.weight - a.weight);
}

// ---------- titles ----------
const NOISE = /official|video|audio|lyric|remaster|full song|\bhd\b|\b4k\b|visuali[sz]er/i;
const cleanTitle = (s) => clean(clean(s).replace(/[([][^)\]]*[)\]]/g, (b) => (NOISE.test(b) ? '' : b)).split('|')[0]) || clean(s);
const matchKey = (title, artist) => [cleanTitle(title), clean(artist)].map((s) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '')).join('|');

// ---------- Last.fm with a disk cache ----------
const CACHE_FILE = new URL('./.lastfm-cache.json', import.meta.url);
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* no cache yet */ }
let apiCalls = 0, cacheHits = 0, unsaved = 0;
const saveCache = () => { try { writeFileSync(CACHE_FILE, JSON.stringify(cache)); unsaved = 0; } catch { /* optional */ } };
class Fatal extends Error {}

async function lastfm(method, params, slim) {
  const key = method + '?' + JSON.stringify(params); // the API key is never part of the cache
  const hit = cache[key];
  if (!FRESH && hit && Date.now() - hit.t < CACHE_DAYS * 86400000) { cacheHits++; return hit.data; }

  const url = new URL(API);
  for (const [k, v] of Object.entries({ method, ...params, api_key: API_KEY, format: 'json' })) url.searchParams.set(k, String(v));

  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (apiCalls >= MAX_REQUESTS) throw new Fatal(`reached --max-requests ${MAX_REQUESTS}`);
    await sleep(DELAY_MS + (attempt ? 3000 * attempt : 0));
    let res, json;
    try {
      apiCalls++;
      res = await fetch(url, { headers: { 'User-Agent': 'MoodTide/1.0 (university project)' }, signal: AbortSignal.timeout(20000) });
      json = await res.json().catch(() => null);
    } catch (e) { last = e.message; continue; }
    const code = Number(json?.error) || 0;
    if ([4, 10, 26].includes(code)) throw new Fatal(`Last.fm refused the API key: ${json.message} (code ${code})`);
    if (code === 29 || res.status === 429) { last = 'rate limit'; if (attempt === 3) throw new Fatal('Last.fm rate limit. Wait a while and run again.'); continue; }
    if ([8, 11, 16].includes(code) || res.status >= 500) { last = json?.message || `HTTP ${res.status}`; continue; }
    let data;
    if (code === 6 && /not (be )?found/i.test(json.message || '')) data = []; // Last.fm does not know it
    else if (!res.ok || code || !json) throw new Error(`Last.fm said: ${json?.message || `HTTP ${res.status}`}${code ? ` (code ${code})` : ''}`);
    else data = slim(json);
    cache[key] = { t: Date.now(), data };
    if (++unsaved >= 20) saveCache();
    return data;
  }
  throw new Error(`Last.fm did not answer (${last})`);
}
const slimTags = (j) => {
  if (!j.toptags) throw new Error('unexpected Last.fm answer (no toptags)');
  return asList(j.toptags.tag).map((t) => ({ name: t.name, count: t.count }));
};

// ---------- Jamendo fallback: reuse the tags the A12 importer already downloaded ----------
function jamendoTags() {
  const out = new Map();
  try {
    const c = JSON.parse(readFileSync(new URL('./.jamendo-cache.json', import.meta.url), 'utf8'));
    for (const entry of Object.values(c)) {
      for (const t of entry.data?.results || []) {
        const tg = t.musicinfo?.tags || {};
        out.set(String(t.id), [...asList(tg.genres), ...asList(tg.vartags)]);
      }
    }
  } catch (e) { warn(`Jamendo cache not readable (${e.message}). Run the Jamendo importer with --dry-run first.`); }
  return out;
}

async function tagsFor(song, jam) {
  // Autocorrect helps with messy YouTube names. For small Jamendo artists it could point to someone else.
  const autocorrect = song.source === 'jamendo' ? 0 : 1;
  const artist = clean(song.artist);
  const picked = new Map();
  const add = (list, source) => {
    for (const x of list) if (picked.size < TOP && !picked.has(x.tag)) picked.set(x.tag, { ...x, source });
  };
  add(topTags(await lastfm('track.getTopTags', { artist, track: cleanTitle(song.title), autocorrect }, slimTags), artist), 'lastfm_track');
  if (picked.size < TOP) add(topTags(await lastfm('artist.getTopTags', { artist, autocorrect }, slimTags), artist), 'lastfm_artist');
  if (picked.size < NEED && jam && song.source === 'jamendo') {
    add(topTags((jam.get(String(song.external_id)) || []).map((name) => ({ name, count: JAM_WEIGHT })), artist), 'jamendo');
  }
  return [...picked.values()];
}

async function enrichTags() {
  const songs = await query(
    `SELECT s.song_id, s.title, s.source, s.external_id, a.name AS artist
     FROM songs s JOIN artists a ON a.artist_id = s.artist_id
     WHERE s.is_active AND (@src::text IS NULL OR s.source = @src)
     ORDER BY s.song_id LIMIT @lim`, { src: SOURCE, lim: LIMIT });
  console.log(`\nTags: ${songs.length} song(s)${DRY_RUN ? '  (dry run)' : ''}`);
  if (!songs.length) return;
  const jam = JAM_FALLBACK ? jamendoTags() : null;
  const stat = {};
  let failed = 0, done = 0, shown = 0;
  for (const song of songs) {
    let tags;
    try { tags = await tagsFor(song, jam); }
    catch (e) {
      if (e instanceof Fatal) throw e;
      failed++; warn(`${song.artist} - ${song.title}: ${e.message}`);
      if (failed >= 10 && done === 0) throw new Fatal('the first 10 songs all failed');
      continue;
    }
    done++;
    const s = (stat[song.source] ||= { songs: 0, enough: 0, some: 0, none: 0 });
    s.songs++;
    s[tags.length >= NEED ? 'enough' : tags.length ? 'some' : 'none']++;
    if (DRY_RUN && shown < 12) { shown++; console.log(`  ${song.artist} - ${song.title}: ${tags.map((t) => `${t.tag}(${t.weight})`).join(', ') || 'no tags'}`); }
    // An empty answer never deletes tags saved earlier.
    if (!DRY_RUN && tags.length) {
      await withTx(async (tx) => {
        await query('DELETE FROM song_tags WHERE song_id = @s', { s: song.song_id }, tx);
        for (const t of tags) {
          await query('INSERT INTO song_tags (song_id, tag, weight, source) VALUES (@s, @t, @w, @src)',
            { s: song.song_id, t: t.tag, w: t.weight, src: t.source }, tx);
        }
      });
    }
    if (done % 50 === 0) console.log(`  ...${done}/${songs.length}`);
  }
  console.log('\nsource       checked   3+ tags   1-2   none');
  for (const [k, s] of Object.entries(stat)) console.log(k.padEnd(12) + String(s.songs).padStart(8) + String(s.enough).padStart(10) + String(s.some).padStart(6) + String(s.none).padStart(7));
  const enough = Object.values(stat).reduce((n, s) => n + s.enough, 0);
  console.log(`This run: ${enough} of ${done} checked songs got 3 or more tags (${done ? (100 * enough / done).toFixed(1) : 0}%).${failed ? `  ${failed} failed: run again.` : ''}`);
  if (failed) process.exitCode = 1;
  if (!DRY_RUN) {
    const [c] = await query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE (SELECT count(*) FROM song_tags t WHERE t.song_id = s.song_id) >= @need) AS ok
       FROM songs s WHERE s.is_active`, { need: NEED });
    console.log(`WHOLE CATALOG: ${c.ok} of ${c.total} active songs have 3+ tags (${c.total ? (100 * c.ok / c.total).toFixed(1) : 0}%). Target: 80%.`);
  }
}

async function refreshChart() {
  console.log(`\nChart: top tracks in ${COUNTRY}${DRY_RUN ? '  (dry run)' : ''}`);
  const rows = await lastfm('geo.getTopTracks', { country: COUNTRY, limit: 50 }, (j) => {
    const root = j.tracks || j.toptracks;
    if (!root) throw new Error('unexpected Last.fm answer (no tracks)');
    return asList(root.track).map((t) => ({ title: t.name, artist: t.artist?.name, url: t.url }));
  });
  const songs = await query(
    `SELECT s.song_id, s.title, a.name AS artist FROM songs s JOIN artists a ON a.artist_id = s.artist_id
     WHERE s.is_active ORDER BY s.popularity DESC, s.song_id`);
  const mine = new Map();
  for (const s of songs) { const k = matchKey(s.title, s.artist); if (!mine.has(k)) mine.set(k, s.song_id); }
  const chart = rows.map((r) => ({ title: clean(r.title), artist: clean(r.artist), url: r.url || null }))
    .filter((r) => r.title && r.artist)
    .map((r, i) => ({ ...r, position: i + 1, songId: mine.get(matchKey(r.title, r.artist)) || null }));
  console.log(`  ${chart.length} tracks, ${chart.filter((r) => r.songId).length} found in your catalog`);
  for (const r of chart.slice(0, 5)) console.log(`  ${r.position}. ${r.artist} - ${r.title}${r.songId ? '  [in catalog]' : ''}`);
  if (!chart.length) { warn('empty chart, the saved one is kept'); process.exitCode = 1; return; }
  if (DRY_RUN) return;
  await withTx(async (tx) => {
    await query('DELETE FROM chart_tracks WHERE country = @c', { c: COUNTRY }, tx);
    for (const r of chart) {
      await query(
        `INSERT INTO chart_tracks (country, position, title, artist, lastfm_url, song_id)
         VALUES (@c, @p, @t, @a, @u, @s)`,
        { c: COUNTRY, p: r.position, t: r.title, a: r.artist, u: r.url, s: r.songId }, tx);
    }
  });
  console.log('  chart saved');
}

async function main() {
  if (!API_KEY) throw new Error('LASTFM_API_KEY is missing. Put it in server/.env and run from the server folder.');
  if (!DRY_RUN) {
    const [t] = await query(`SELECT to_regclass('song_tags') IS NOT NULL AND to_regclass('chart_tracks') IS NOT NULL AS ok`);
    if (!t.ok) throw new Error('Tables are missing. Run db/init/02_tags.sql once, then try again.');
  }
  if (!CHART_ONLY) await enrichTags();
  if (!TAGS_ONLY) await refreshChart();
}

main()
  .catch((e) => { console.error('\nEnrichment failed:', e.message); process.exitCode = 1; })
  .finally(() => { saveCache(); console.log(`\nLast.fm requests: ${apiCalls} (${cacheHits} from the saved cache)`); return closePool().catch(() => {}); });
