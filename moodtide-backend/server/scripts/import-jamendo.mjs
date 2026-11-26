#!/usr/bin/env node
// =====================================================================
// MoodTide A12: import Creative Commons music from Jamendo into PostgreSQL.
//
//   Jamendo API (free client id)  -> title, artist, cover, length, licence, mood tags
//                                    and a direct audio stream URL (no YouTube needed)
//
// Put this file in:  moodtide-backend/server/scripts/import-jamendo.mjs
// Run it from:       moodtide-backend/server
//
//   node scripts/import-jamendo.mjs --dry-run                 (fetch + plan, saves nothing)
//   node scripts/import-jamendo.mjs                           (about 300 tracks over 9 tags)
//   node scripts/import-jamendo.mjs --tag calm --limit 40     (one tag only)
//   node scripts/import-jamendo.mjs --limit 300 --max-per-artist 5
//   node scripts/import-jamendo.mjs --licenses by,by-sa       (only licences that allow commercial use)
//   node scripts/import-jamendo.mjs --dry-run --check-audio   (also test that stream URLs answer)
//   node scripts/import-jamendo.mjs --fresh                   (ignore the saved API responses)
//
// Other flags: --format mp31|mp32|ogg (stream quality, default mp32)
//              --min-sec 60 --max-sec 600 (keep tracks in this length range)
//              --max-requests 80 (safety stop for the monthly request limit)
//
// .env needs: JAMENDO_CLIENT_ID and the DB_* settings (or DATABASE_URL), same as the server.
//
// REQUEST LIMIT: the free plan has a monthly request limit. One request returns up to 100 tracks,
// so a full run is about 9 to 27 requests. Every response is saved next to this script for 7 days
// (scripts/.jamendo-cache.json), so a dry run followed by the real run costs the requests only once.
//
// LICENCES: only tracks whose Creative Commons licence is in --licenses are kept. The default
// allows BY, BY-SA, BY-NC, BY-NC-SA and CC0 (NoDerivs is skipped: a clip is an edit). The NC
// licences are fine for a course project but NOT if MoodTide ever earns money: then run with
// --licenses by,by-sa,cc0. Each song stores license, attribution_text and source_url so the player
// can show the credit that Jamendo's terms require (artist, "Jamendo", and a link to the track page).
//
// HONEST NOTE: energy / happiness / tempo / danceability / acousticness are ESTIMATES from Jamendo's
// own tags (speed, acoustic or electric, genre, mood words). Songs are saved with
// feature_source = 'tags'. Task A21 replaces them with measured values.
// =====================================================================
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { query, withTx, closePool } from '../src/db.js';

// ---------- command line (same style as import-catalog.mjs) ----------
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
const LIMIT = intOpt('limit', 300, 1, 5000);              // total tracks to keep
const ONLY_TAG = String(opt('tag', '')).trim().toLowerCase();
const MAX_PER_ARTIST = intOpt('max-per-artist', 5, 1, 100); // keeps one popular artist from filling a tag
const MIN_SEC = intOpt('min-sec', 60, 10, 3600);
const MAX_SEC = intOpt('max-sec', 600, 30, 7200);
const MAX_REQUESTS = intOpt('max-requests', 80, 1, 1000);
const AUDIO_FORMAT = ['mp31', 'mp32', 'ogg'].includes(opt('format', 'mp32')) ? opt('format', 'mp32') : 'mp32';
const ACCEPT = new Set(String(opt('licenses', 'by,by-sa,by-nc,by-nc-sa,cc0')).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
const FRESH = has('fresh');
const CHECK_AUDIO = has('check-audio');

const CLIENT_ID = String(process.env.JAMENDO_CLIENT_ID || '').trim();
const API = process.env.JAMENDO_API_BASE || 'https://api.jamendo.com/v3.0'; // override only for tests
const PAGE_SIZE = 100;     // Jamendo allows up to 200 per request
const MAX_PAGES = 3;       // per tag
const DELAY_MS = 400;      // pause between real requests
const CACHE_DAYS = 7;

// The tags from the task book. Jamendo tags are English words (genre, instrument or mood).
const TAGS = ['calm', 'chill', 'sleep', 'focus', 'world', 'folk', 'acoustic', 'upbeat', 'sad'];

// ---------- small helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round3 = (x) => Math.round(x * 1000) / 1000;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();   // Jamendo titles can contain line breaks
const unit = (s) => parseInt(createHash('md5').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff;
const jitter = (key, amount) => (unit(key) - 0.5) * 2 * amount;
const warn = (m) => console.warn(`  ! ${m}`);
const lengthClass = (sec) => (sec < 90 ? 'short' : sec <= 480 ? 'standard' : 'long'); // same rule as A15

// ---------- Jamendo API with a disk cache ----------
const CACHE_FILE = new URL('./.jamendo-cache.json', import.meta.url);
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* no cache yet */ }
let apiCalls = 0, cacheHits = 0, quotaHit = false;

// The response also holds a long "waveform" for every track. Keep only what we use, so the cache stays small.
const slim = (t) => ({
  id: t.id, name: t.name, duration: t.duration, artist_id: t.artist_id, artist_name: t.artist_name,
  album_id: t.album_id, album_name: t.album_name, license_ccurl: t.license_ccurl, releasedate: t.releasedate,
  audio: t.audio, shareurl: t.shareurl, image: t.image, album_image: t.album_image, musicinfo: t.musicinfo,
});

async function jamendo(path, params) {
  const p = { format: 'json', ...params };
  // The client id is NOT part of the cache key, so it never lands in the cache file.
  const key = path + '?' + Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const hit = cache[key];
  if (!FRESH && hit && Date.now() - hit.t < CACHE_DAYS * 86400000) { cacheHits++; return hit.data; }

  if (apiCalls >= MAX_REQUESTS) throw new Error(`Stopped: reached --max-requests ${MAX_REQUESTS}. Raise it if you really want more requests.`);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(p)) url.searchParams.set(k, String(v));
  url.searchParams.set('client_id', CLIENT_ID);

  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(DELAY_MS);
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(25000) }); }
    catch (e) { if (attempt === 3) throw new Error(`Jamendo is unreachable (${e.message})`); await sleep(2000 * (attempt + 1)); continue; }
    apiCalls++;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(5000 * (attempt + 1)); continue; }
    const json = await res.json().catch(() => null);
    const h = json?.headers;
    if (!res.ok || !h || h.status !== 'success') {
      const msg = h?.error_message || `HTTP ${res.status}`;
      if (/limit|quota|too many|exceed/i.test(msg) || res.status === 429) quotaHit = true;
      throw new Error(`Jamendo said: ${msg}${h?.code !== undefined ? ` (code ${h.code})` : ''}`);
    }
    const data = { count: Number(h.results_count) || 0, results: (json.results || []).map(slim) };
    cache[key] = { t: Date.now(), data };
    try { writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch { /* cache is optional */ }
    return data;
  }
  throw new Error('Jamendo kept refusing (rate limit). Wait a few minutes and run again.');
}

// ---------- licence ----------
// "http://creativecommons.org/licenses/by-nc-nd/3.0/" -> { code: 'by-nc-nd', name: 'CC BY-NC-ND 3.0', url: 'https://...' }
function parseLicense(url) {
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z0-9-]+)\/?([\d.]+)?/i.exec(url || '');
  if (!m) return null;
  const code = m[2].toLowerCase();
  const secure = String(url).replace(/^http:/i, 'https:');
  if (m[1].toLowerCase() === 'publicdomain' || code === 'zero') return { code: 'cc0', name: 'CC0 1.0', url: secure };
  return { code, name: `CC ${code.toUpperCase()}${m[3] ? ' ' + m[3] : ''}`, url: secure };
}

// ---------- features (ESTIMATES from tags) ----------
// Jamendo "speed" tag -> energy and tempo starting points
const SPEED = {
  verylow: { e: 0.20, t: 65 }, low: { e: 0.35, t: 82 }, medium: { e: 0.50, t: 102 },
  high: { e: 0.68, t: 125 }, veryhigh: { e: 0.82, t: 150 },
};
// Mood words (Jamendo "vartags" plus the tag we searched with) -> small nudges. e=energy h=happiness d=danceability a=acousticness t=tempo
// Same idea and patterns as MOOD_TAGS in import-catalog.mjs.
const MOOD_TAGS = [
  [/^(sad|melanchol|heartbreak|emotional|lonely|nostalg|dramatic)/, { e: -0.10, h: -0.30 }],
  [/^(chill|relax|calm|mellow|soft|sleep|peaceful|lounge|ambient|meditat|dream|focus|background)/, { e: -0.20, t: -10 }],
  [/^(party|dance|club|upbeat|energetic|workout|hype|powerful|groovy|fun)/, { e: 0.16, h: 0.10, d: 0.14, t: 8 }],
  [/^(happy|cheerful|joy|uplifting|summer|positive|feel good|sunny)/, { e: 0.05, h: 0.25 }],
  [/^(romantic|love|sensual)/, { e: -0.05, h: 0.10 }],
  [/^(dark|angry|aggressive|intense|epic|tense)/, { e: 0.14, h: -0.25 }],
  [/^(acoustic|unplugged)/, { e: -0.08, a: 0.15 }],
];
// Genre words -> nudges (the genre decides danceability and acousticness more than mood)
const GENRE_TAGS = [
  [/^(electro|techno|house|dance|edm|trance|dubstep)/, { e: 0.10, d: 0.18, a: -0.15 }],
  [/^(hiphop|rap|trap)/, { e: 0.08, d: 0.20, a: -0.10 }],
  [/^(rock|metal|punk|grunge)/, { e: 0.14, d: -0.05, a: -0.10 }],
  [/^(funk|soul|rnb|disco)/, { e: 0.06, d: 0.18 }],
  [/^(classical|orchestral|piano|soundtrack|cinematic)/, { e: -0.10, d: -0.15, a: 0.20 }],
  [/^(folk|singersongwriter|songwriter|country|bluegrass|acoustic)/, { e: -0.05, d: -0.05, a: 0.20 }],
  [/^(jazz|blues)/, { d: 0.05, a: 0.10 }],
  [/^(ambient|newage|relaxation|chillout|downtempo|lofi)/, { e: -0.10, d: -0.10 }],
];

function estimate(r) {
  const sp = SPEED[r.speed] || { e: 0.5, t: 100 };
  let e = sp.e, h = 0.5, t = sp.t, d = 0.3 + sp.e * 0.45;
  let a = r.acousticelectric === 'acoustic' ? 0.78 : r.acousticelectric === 'electric' ? 0.22 : 0.40;
  const k = `jam${r.id}`;
  e += jitter(k + 'e', 0.05); h += jitter(k + 'h', 0.08); d += jitter(k + 'd', 0.06); a += jitter(k + 'a', 0.06); t += jitter(k + 't', 6);

  // Each mood group counts ONCE per song: "chill", "dream" and the search tag "calm" are the same
  // idea, so three of them must not push the energy down three times.
  const hits = [];
  const usedMood = new Set();
  for (const raw of [...r.vartags, r.tag]) {
    const name = String(raw).toLowerCase().trim();
    const i = MOOD_TAGS.findIndex(([re]) => re.test(name));
    if (i < 0 || usedMood.has(i)) continue;
    usedMood.add(i);
    const adj = MOOD_TAGS[i][1];
    e += adj.e || 0; h += adj.h || 0; d += adj.d || 0; a += adj.a || 0; t += adj.t || 0;
    hits.push(name);
  }
  const usedGenre = new Set();
  for (const g of r.genres) {
    const name = String(g).toLowerCase().replace(/[^a-z]/g, '');
    const i = GENRE_TAGS.findIndex(([re]) => re.test(name));
    if (i < 0 || usedGenre.has(i)) continue;
    usedGenre.add(i);
    const adj = GENRE_TAGS[i][1];
    e += adj.e || 0; d += adj.d || 0; a += adj.a || 0;
    hits.push(`genre:${name}`);
  }
  r.moodHits = hits;
  return {
    energy: round3(clamp(e, 0, 1)), happiness: round3(clamp(h, 0, 1)), tempo: Math.round(clamp(t, 40, 220)),
    danceability: round3(clamp(d, 0, 1)), acousticness: round3(clamp(a, 0, 1)),
  };
}

// ---------- genres: Jamendo genre word -> one of YOUR genres ----------
// The first of your genres whose name matches the pattern is used. Nothing is created here (A16 adds genres).
const JAM_TO_DB = [
  [/^(hiphop|rap|trap)/, /hip|rap|trap/i],
  [/^(electro|house|techno|dance|edm|trance|dubstep)/, /electro|edm|dance/i],
  [/^(rock|metal|punk|grunge|alternative)/, /rock|metal|punk|alt/i],
  [/^(pop)/, /^pop/i],
  [/^(folk|singersongwriter|songwriter|country|bluegrass|acoustic)/, /acoustic|folk|indie|country|singer/i],
  [/^(classical|orchestral|piano|soundtrack|cinematic)/, /classical|orchestra|soundtrack/i],
  [/^(jazz|blues|lounge)/, /jazz|blues|lounge/i],
  [/^(funk|soul|rnb|disco)/, /soul|r&b|rnb|funk/i],
  [/^(ambient|newage|relaxation|chillout|downtempo|lofi)/, /ambient|chill|lo-?fi|relax/i],
  [/^(reggae|ska)/, /reggae/i],
  [/^(latin)/, /latin/i],
  [/^(world|ethnic|oriental)/, /world/i],
];
// Your regional genres (Punjabi Folk, Bollywood, Qawwali...) are for music from those traditions.
// Jamendo songs are mostly Western independent music, so they are never put into these.
const REGIONAL = /punjabi|ghazal|qawwali|sufi|naat|hamd|manqabat|nasheed|urdu|bollywood|k-?pop|j-?pop|coke studio|desi|pakistani|indian|islamic/i;
// If none of the song's own genres match, fall back on the tag we searched with.
const TAG_FALLBACK = {
  calm: /ambient|chill|classical|acoustic/i, chill: /chill|lo-?fi|ambient|electro/i, sleep: /ambient|classical|chill/i,
  focus: /ambient|classical|electro|lo-?fi/i, world: /world|folk|acoustic/i, folk: /folk|acoustic|indie/i,
  acoustic: /acoustic|folk|indie/i, upbeat: /pop|dance|electro/i, sad: /acoustic|indie|classical|pop/i,
};
function pickGenres(r, dbGenres) {
  const find = (re) => dbGenres.filter((g) => re.test(g.name) && !REGIONAL.test(g.name)).sort((a, b) => a.name.length - b.name.length)[0];
  const ids = new Set();
  for (const raw of r.genres) {
    const key = String(raw).toLowerCase().replace(/[^a-z]/g, '');
    const rule = JAM_TO_DB.find(([jre]) => jre.test(key));
    const hit = rule && find(rule[1]);
    if (hit) ids.add(hit.genre_id);
  }
  let fellBack = false;
  if (!ids.size) {
    fellBack = true;
    const hit = (TAG_FALLBACK[r.tag] && find(TAG_FALLBACK[r.tag])) || find(/^pop$/i) || dbGenres.find((g) => !REGIONAL.test(g.name)) || dbGenres[0];
    if (hit) ids.add(hit.genre_id);
  }
  return { ids: [...ids].slice(0, 2), fellBack };
}

// ---------- how to search for one tag ----------
// Jamendo's `tags` filter only knows its own tag words. Some of ours (folk, acoustic, sad, focus) found
// nothing or almost nothing with it, so when a tag comes up short we try, in this order:
//   tags       exact tag match
//   fuzzy      any of several related tags (fuzzytags, a space means OR)
//   search     free text search over title, artist and tags
//   acoustic   only for the tag "acoustic": Jamendo's acoustic/electric filter
// The table shows which way each tag was found.
const SYNONYMS = {
  calm: ['calm', 'peaceful', 'relaxing'], chill: ['chill', 'chillout', 'relaxing'],
  sleep: ['sleep', 'relaxation', 'ambient', 'calm'], focus: ['focus', 'concentration', 'ambient', 'instrumental'],
  world: ['world', 'ethnic'], folk: ['folk', 'singersongwriter', 'country'],
  acoustic: ['acoustic', 'guitar', 'singersongwriter'], upbeat: ['upbeat', 'happy', 'energetic', 'dance'],
  sad: ['sad', 'melancholic', 'emotional'],
};
function attemptsFor(tag) {
  const list = [{ via: 'tags', params: { tags: tag } }];
  if (SYNONYMS[tag]) list.push({ via: 'fuzzy', params: { fuzzytags: SYNONYMS[tag].join(' ') } });
  list.push({ via: 'search', params: { search: tag } });
  if (tag === 'acoustic') list.push({ via: 'acoustic', params: { acousticelectric: 'acoustic' } });
  return list;
}

// ---------- fetch one tag ----------
async function collectTag(tag, quota, taken, artistCount) {
  const out = [];
  const stat = { scanned: 0, kept: 0, license: 0, noAudio: 0, length: 0, dup: 0, artistCap: 0, via: {} };
  let rank = 0;
  for (const attempt of attemptsFor(tag)) {
    if (out.length >= quota) break;
    for (let page = 0; page < MAX_PAGES && out.length < quota; page++) {
      const batch = await jamendo('/tracks/', {
        ...attempt.params, order: 'popularity_total', type: 'single albumtrack', include: 'musicinfo',
        audioformat: AUDIO_FORMAT, imagesize: 600, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
      });
      for (const t of batch.results) {
        stat.scanned++;
        const myRank = rank++;
        if (out.length >= quota) continue;
        const id = String(t.id || '');
        const title = clean(t.name);
        const artist = clean(t.artist_name);
        const sec = Math.round(Number(t.duration) || 0);
        if (!id || !title || !artist || !t.audio || !t.artist_id) { stat.noAudio++; continue; }
        if (taken.has(id)) { stat.dup++; continue; }
        const lic = parseLicense(t.license_ccurl);
        if (!lic || !ACCEPT.has(lic.code)) { stat.license++; continue; }
        if (sec < MIN_SEC || sec > MAX_SEC) { stat.length++; continue; }
        const artistId = String(t.artist_id);
        if ((artistCount.get(artistId) || 0) >= MAX_PER_ARTIST) { stat.artistCap++; continue; }

        const mi = t.musicinfo || {};
        const tg = mi.tags || {};
        taken.add(id);
        artistCount.set(artistId, (artistCount.get(artistId) || 0) + 1);
        out.push({
          id, title, artist, artistId, sec,
          albumId: t.album_id ? String(t.album_id) : null,
          album: clean(t.album_name) || title,
          cover: t.album_image || t.image || null,
          year: parseInt(String(t.releasedate || '').slice(0, 4), 10) || null,
          license: lic,
          audio: t.audio,
          page: t.shareurl || `https://www.jamendo.com/track/${id}`,
          genres: Array.isArray(tg.genres) ? tg.genres : [],
          vartags: Array.isArray(tg.vartags) ? tg.vartags : [],
          speed: mi.speed || '', acousticelectric: mi.acousticelectric || '',
          tag, rank: myRank,
        });
        stat.kept++;
        stat.via[attempt.via] = (stat.via[attempt.via] || 0) + 1;
      }
      if (batch.results.length < PAGE_SIZE) break; // no more pages for this search
    }
  }
  return { out, stat };
}

// ---------- optional: do the stream URLs answer? ----------
async function checkAudio(records, n = 8) {
  const step = Math.max(1, Math.floor(records.length / n));
  const sample = records.filter((_, i) => i % step === 0).slice(0, n);
  console.log(`\nStream check (${sample.length} tracks, first kilobyte only):`);
  let ok = 0;
  for (const r of sample) {
    try {
      const res = await fetch(r.audio, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20000) });
      const type = res.headers.get('content-type') || '?';
      const good = (res.status === 200 || res.status === 206) && /audio|octet-stream|mpeg|ogg/i.test(type);
      if (good) ok++;
      console.log(`  ${good ? 'ok  ' : 'FAIL'} ${res.status} ${type.padEnd(22)} ${r.artist} - ${r.title}`);
      await res.body?.cancel().catch(() => {});
    } catch (e) { console.log(`  FAIL ${e.message}  ${r.artist} - ${r.title}`); }
  }
  console.log(`  ${ok}/${sample.length} answered with audio.`);
}

// ---------- main ----------
async function main() {
  if (!CLIENT_ID) {
    console.error('JAMENDO_CLIENT_ID is missing. Put it in moodtide-backend/server/.env (see .env.example) and run from that folder.');
    process.exit(1);
  }
  if (!ACCEPT.size) { console.error('--licenses is empty. Example: --licenses by,by-sa,by-nc,by-nc-sa'); process.exit(1); }
  const tags = ONLY_TAG ? [ONLY_TAG] : TAGS;
  const quota = Math.ceil(LIMIT / tags.length);
  console.log(`Jamendo import: ${tags.length} tag(s), about ${quota} tracks each, up to ${LIMIT} in total.${DRY_RUN ? '  (dry run: nothing is saved)' : ''}`);
  console.log(`Licences kept: ${[...ACCEPT].join(', ')}   length ${MIN_SEC}-${MAX_SEC}s   max ${MAX_PER_ARTIST} per artist   stream ${AUDIO_FORMAT}\n`);

  // ----- 1) your genres (used to map Jamendo genres). A dry run may go on without the database. -----
  let dbGenres = [], dbOk = true;
  try {
    dbGenres = await query('SELECT genre_id, name FROM genres ORDER BY name');
    if (!dbGenres.length) throw new Error('the genres table is empty (seed the database first)');
  } catch (e) {
    dbOk = false;
    if (!DRY_RUN) { console.error(`Cannot read the database: ${e.message}`); process.exitCode = 1; return; }
    warn(`database not available (${e.message}). The plan below shows no genre mapping and no new/existing split.`);
  }

  // ----- 2) fetch each tag -----
  const taken = new Set(), artistCount = new Map();
  const records = [];
  console.log('tag'.padEnd(10) + 'scanned  kept  no-audio  licence  length  duplicate  artist-cap  found by');
  for (const tag of tags) {
    if (quotaHit || records.length >= LIMIT) break;
    try {
      const { out, stat } = await collectTag(tag, Math.min(quota, LIMIT - records.length), taken, artistCount);
      records.push(...out);
      console.log(tag.padEnd(10) + [stat.scanned, stat.kept, stat.noAudio, stat.license, stat.length, stat.dup, stat.artistCap].map((n, i) => String(n).padStart([7, 6, 10, 9, 8, 11, 12][i])).join('') + '  ' + (Object.entries(stat.via).map(([k, v]) => `${k}:${v}`).join(' ') || '-'));
    } catch (e) { warn(`tag "${tag}": ${e.message}`); if (quotaHit) break; }
  }
  console.log(`\nJamendo requests this run: ${apiCalls} (${cacheHits} answered from the saved cache)`);
  if (quotaHit) warn('Jamendo reported a limit. Stop here and run again later.');

  // ----- 3) summary -----
  const count = (fn) => records.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`Tracks ready: ${records.length}`);
  if (!records.length) { console.error('Nothing matched, so nothing was saved. Read the "!" lines above.'); process.exitCode = 1; return; }
  console.log(`  by licence: ${JSON.stringify(count((r) => r.license.name))}`);
  console.log(`  by length:  ${JSON.stringify(count((r) => lengthClass(r.sec)))}`);
  console.log(`  artists:    ${new Set(records.map((r) => r.artistId)).size}`);

  const plan = records.map((r) => ({ r, f: estimate(r), g: dbOk ? pickGenres(r, dbGenres) : { ids: [], fellBack: false } }));
  if (dbOk) {
    const fb = plan.filter((p) => p.g.fellBack).length;
    console.log(`  genre match: ${plan.length - fb} from the song's own genres, ${fb} from the search tag (fallback)`);
    const existing = await query(`SELECT external_id FROM songs WHERE source = 'jamendo' AND external_id = ANY(@ids)`, { ids: records.map((r) => r.id) });
    console.log(`  already in the database: ${existing.length}  ->  new: ${records.length - existing.length}`);
  }

  if (DRY_RUN) {
    console.log('\nSample (first 12):');
    for (const { r, f, g } of plan.slice(0, 12)) {
      const gn = g.ids.map((id) => dbGenres.find((x) => x.genre_id === id)?.name).filter(Boolean).join('+') || '-';
      console.log(`  [${r.tag}] ${r.artist} - ${r.title} (${r.sec}s, ${r.license.name}) genre:${gn} e=${f.energy} h=${f.happiness} t=${f.tempo}  hits: ${r.moodHits.join(', ') || 'none'}`);
    }
    if (CHECK_AUDIO) await checkAudio(records);
    console.log('\nDry run finished. Run again without --dry-run to save.');
    return;
  }

  // ----- 4) save, all in one transaction. Running it twice never creates duplicates. -----
  const result = await withTx(async (tx) => {
    let inserted = 0, updated = 0;
    for (const { r, f, g } of plan) {
      // artist (unique on source + external_id)
      const [artist] = await query(
        `INSERT INTO artists (artist_id, name, source, external_id)
         VALUES (@id, @name, 'jamendo', @ext)
         ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name
         RETURNING artist_id`,
        { id: `jama_${r.artistId}`, name: r.artist, ext: r.artistId }, tx);

      // album. A single has no album at Jamendo, so it gets its own album row: that is where the cover lives.
      const albumExt = r.albumId || `t${r.id}`;
      const [album] = await query(
        `INSERT INTO albums (album_id, artist_id, title, release_year, cover_url, source, external_id)
         VALUES (@id, @artist, @title, @year, @cover, 'jamendo', @ext)
         ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET title = EXCLUDED.title,
                       release_year = COALESCE(EXCLUDED.release_year, albums.release_year),
                       cover_url = COALESCE(EXCLUDED.cover_url, albums.cover_url)
         RETURNING album_id`,
        { id: `jamb_${albumExt}`, artist: artist.artist_id, title: r.album, year: r.year, cover: r.cover, ext: albumExt }, tx);

      // song. is_active is NOT touched on a re-run, so a song an admin took down stays down.
      const popularity = clamp(Math.round(80 - r.rank * 0.25), 30, 80); // rough: Jamendo's own popularity order within the tag
      const attribution = `"${r.title}" by ${r.artist}, from Jamendo. Licensed under ${r.license.name} (${r.license.url}).`;
      const [song] = await query(
        `INSERT INTO songs (song_id, artist_id, album_id, title, duration_sec, release_year, audio_url, popularity,
                            is_active, source, external_id, external_url, content_type, region,
                            license, attribution_text, source_url, length_class)
         VALUES (@id, @artist, @album, @title, @dur, @year, @audio, @pop,
                 true, 'jamendo', @ext, @link, 'music', 'international',
                 @license, @attr, @src, @len)
         ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET title = EXCLUDED.title, duration_sec = EXCLUDED.duration_sec,
                       release_year = COALESCE(EXCLUDED.release_year, songs.release_year),
                       audio_url = EXCLUDED.audio_url, popularity = EXCLUDED.popularity,
                       external_url = EXCLUDED.external_url, license = EXCLUDED.license,
                       attribution_text = EXCLUDED.attribution_text, source_url = EXCLUDED.source_url,
                       length_class = EXCLUDED.length_class
         RETURNING song_id, (xmax = 0) AS inserted`,
        { id: `jam_${r.id}`, artist: artist.artist_id, album: album.album_id, title: r.title, dur: r.sec, year: r.year,
          audio: r.audio, pop: popularity, ext: r.id, link: r.page, license: r.license.name, attr: attribution,
          src: r.page, len: lengthClass(r.sec) }, tx);
      if (song.inserted) inserted++; else updated++;

      // features: never overwrite values measured later (A21)
      await query(
        `INSERT INTO song_features (song_id, energy, happiness, tempo, danceability, acousticness, feature_source)
         VALUES (@id, @e, @h, @t, @d, @a, 'tags')
         ON CONFLICT (song_id) DO UPDATE
           SET energy = EXCLUDED.energy, happiness = EXCLUDED.happiness, tempo = EXCLUDED.tempo,
               danceability = EXCLUDED.danceability, acousticness = EXCLUDED.acousticness, feature_source = 'tags'
           WHERE song_features.feature_source IN ('tags', 'estimated')`,
        { id: song.song_id, e: f.energy, h: f.happiness, t: f.tempo, d: f.danceability, a: f.acousticness }, tx);

      for (const gid of g.ids) {
        await query(`INSERT INTO song_genres (song_id, genre_id) VALUES (@s, @g) ON CONFLICT DO NOTHING`, { s: song.song_id, g: gid }, tx);
      }
    }
    return { inserted, updated };
  });
  console.log(`\nSaved ${result.inserted} new tracks, updated ${result.updated} existing ones.`);
  if (CHECK_AUDIO) await checkAudio(records);
}

main()
  .catch((e) => { console.error('\nImport failed:', e.message); process.exitCode = 1; })
  .finally(() => closePool().catch(() => {}));
