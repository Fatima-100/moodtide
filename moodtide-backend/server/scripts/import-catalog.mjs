#!/usr/bin/env node
// =====================================================================
// MoodTide PART 2: build a better catalog from three sources.
//
//   iTunes Search API (no key)  -> real title, release year, genre, album art
//   Last.fm API (free key)      -> user tags: region (punjabi, k-pop...) and mood (sad, chill...)
//   YouTube Data API            -> the video that plays the song (same as import-youtube.mjs)
//
// Put this file in:  moodtide-backend/server/scripts/import-catalog.mjs
// Run it from:       moodtide-backend/server
//
//   node scripts/import-catalog.mjs --dry-run                 (search + match, saves nothing)
//   node scripts/import-catalog.mjs                           (all artists, 12 songs each)
//   node scripts/import-catalog.mjs --only punjabi            (one region: punjabi|indian|korean|japanese)
//   node scripts/import-catalog.mjs --artist "Sidhu Moose Wala:punjabi"   (one extra artist)
//   node scripts/import-catalog.mjs --per-artist 20 --searches 2
//   node scripts/import-catalog.mjs --no-lastfm               (skip Last.fm, use the region of the artist list)
//   node scripts/import-catalog.mjs --country PK              (iTunes store; default US, has the biggest catalog)
//
// .env needs: DB_SERVER DB_PORT DB_NAME DB_USER DB_PASSWORD YOUTUBE_API_KEY
// and optionally: LASTFM_API_KEY
//
// QUOTA: one YouTube search = 100 units (free limit 10,000/day). Default is 1 search per artist.
// HONEST NOTE: energy / happiness / tempo are still ESTIMATES. They start from the genre and are
// nudged by Last.fm mood tags ("sad", "chill", "party"). Tags are real data, tempo is not measured.
// Songs are saved with feature_source = 'estimated'.
// =====================================================================
import 'dotenv/config';
import sql from 'mssql';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// ---------- command line ----------
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PER_ARTIST = Math.max(1, parseInt(opt('per-artist', '12'), 10) || 12);
const SEARCHES = clampInt(parseInt(opt('searches', '1'), 10) || 1, 1, 2);
const DRY_RUN = has('dry-run');
const ONLY = String(opt('only', '')).toLowerCase();
const EXTRA = String(opt('artist', ''));
const ITUNES_COUNTRY = String(opt('country', 'US')).toUpperCase();
const YT_REGION = String(opt('region', 'PK')).toUpperCase(); // hide videos blocked in this country
const YT_KEY = opt('key', process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || '');
let LASTFM_KEY = has('no-lastfm') ? '' : opt('lastfm-key', process.env.LASTFM_API_KEY || '');
const FRESH = has('fresh'); // ignore the saved YouTube search results
const DURATION_TOLERANCE = 45; // iTunes length vs YouTube length, in seconds
const MIN_SEC = 60, MAX_SEC = 600;

function clampInt(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

// ---------- database connection (same settings as import-youtube.mjs) ----------
const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'MoodTide',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};
async function run(target, text, params = {}) {
  const req = target.request ? target.request() : new sql.Request(target);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) req.input(k, v[0], v[1]);
    else req.input(k, v);
  }
  const result = await req.query(text);
  return result.recordset ?? [];
}

// ---------- artists: [name, region, country] ----------
// Region is only the FALLBACK. Last.fm tags decide first when they have a clear answer.
const ARTISTS = [
  ['Diljit Dosanjh', 'punjabi', 'IN'], ['Karan Aujla', 'punjabi', 'IN'], ['AP Dhillon', 'punjabi', 'IN'],
  ['Sidhu Moose Wala', 'punjabi', 'IN'], ['Gurdas Maan', 'punjabi', 'IN'], ['Babbu Maan', 'punjabi', 'IN'],
  ['Ammy Virk', 'punjabi', 'IN'], ['Jasmine Sandlas', 'punjabi', 'IN'], ['Satinder Sartaaj', 'punjabi', 'IN'],
  ['Gippy Grewal', 'punjabi', 'IN'],
  ['Arijit Singh', 'indian', 'IN'], ['Shreya Ghoshal', 'indian', 'IN'], ['Sonu Nigam', 'indian', 'IN'],
  ['A. R. Rahman', 'indian', 'IN'], ['Neha Kakkar', 'indian', 'IN'],
  ['BTS', 'korean', 'KR'], ['BLACKPINK', 'korean', 'KR'], ['IU', 'korean', 'KR'],
  ['NewJeans', 'korean', 'KR'], ['Stray Kids', 'korean', 'KR'],
  ['YOASOBI', 'japanese', 'JP'], ['Hikaru Utada', 'japanese', 'JP'], ['Kenshi Yonezu', 'japanese', 'JP'],
];

// Last.fm tag -> region. Counts of all tags for a region are added up, the biggest wins.
const TAG_REGION = {
  punjabi: 'punjabi', bhangra: 'punjabi', 'punjabi pop': 'punjabi', 'punjabi music': 'punjabi',
  pakistani: 'pakistani', pakistan: 'pakistani', urdu: 'pakistani', qawwali: 'pakistani',
  bollywood: 'indian', hindi: 'indian', indian: 'indian', 'hindi pop': 'indian',
  'k-pop': 'korean', kpop: 'korean', korean: 'korean',
  'j-pop': 'japanese', jpop: 'japanese', japanese: 'japanese', 'j-rock': 'japanese', anime: 'japanese',
};
const REGION_GENRE = { punjabi: 'Punjabi', pakistani: 'Pakistani', indian: 'Bollywood', korean: 'K-Pop', japanese: 'J-Pop' };

// Last.fm tag -> small nudges to features. e=energy h=happiness d=danceability a=acousticness t=tempo
const MOOD_TAGS = [
  [/^(sad|melanchol|heartbreak|heartache|depress|emotional|crying|lonely)/, { e: -0.12, h: -0.30 }],
  [/^(chill|relax|calm|mellow|soft|sleep|peaceful|lounge|ambient)/,       { e: -0.22, t: -12 }],
  [/^(party|dance|club|upbeat|energetic|workout|gym|hype|banger)/,        { e: 0.18, h: 0.10, d: 0.12, t: 8 }],
  [/^(happy|feel good|fun|summer|cheerful|joy|uplifting)/,                { e: 0.06, h: 0.25 }],
  [/^(romantic|love|sensual)/,                                            { e: -0.05, h: 0.10 }],
  [/^(dark|angry|aggressive|intense)/,                                    { e: 0.15, h: -0.25 }],
  [/^(acoustic|unplugged)/,                                               { e: -0.10, a: 0.20 }],
];

// Used ONLY when Last.fm has no tags for a song. Rough title-word hints (Punjabi/Hindi/Urdu words written in English letters).
// A title word is a weak signal and can be wrong, so the nudges are smaller than the tag ones.
const TITLE_MOOD = [
  [/\b(udaas|udaasi|judai|judaai|dard|dukh|bewafa|bewafai|rona|royi|roya|yaad|yaadan|yaadaan|tanhai|alvida|birha|vichora|intezaar|intezar|hanju|aansu|toota|sad|cry|tears|alone|goodbye)\b/, 'sad', { e: -0.15, h: -0.28, t: -8 }],
  [/\b(ishq|ishqa|pyar|pyaar|mohabbat|muhabbat|sohni|dilbar|dildar|love|lover)\b/, 'romantic', { e: -0.05, h: 0.05 }],
  [/\b(party|bhangra|gabru|gabhru|jatt|jatti|nach|nachde|gedi|vaar|goat|clash|high end|brown munde|beast|dance)\b/, 'energetic', { e: 0.12, d: 0.10, t: 6 }],
];

// Starting feature guesses (energy, happiness, danceability, acousticness, tempo)
const NEUTRAL = { e: 0.5, h: 0.5, d: 0.5, a: 0.4, t: 100 };
const REGION_PROFILE = {
  punjabi:  { e: 0.75, h: 0.72, d: 0.80, a: 0.20, t: 100 },
  indian:   { e: 0.60, h: 0.60, d: 0.65, a: 0.35, t: 100 },
  pakistani:{ e: 0.55, h: 0.55, d: 0.50, a: 0.55, t: 100 },
  korean:   { e: 0.80, h: 0.70, d: 0.78, a: 0.10, t: 118 },
  japanese: { e: 0.72, h: 0.62, d: 0.60, a: 0.20, t: 130 },
};
const ITUNES_PROFILE = [
  [/hip|rap/i,           { e: 0.75, h: 0.55, d: 0.80, a: 0.10, t: 95 }],
  [/r&b|soul/i,          { e: 0.50, h: 0.60, d: 0.70, a: 0.30, t: 100 }],
  [/dance|electro/i,     { e: 0.85, h: 0.65, d: 0.80, a: 0.05, t: 126 }],
  [/rock|alt|metal|punk/i,{ e: 0.80, h: 0.55, d: 0.50, a: 0.15, t: 124 }],
  [/singer|folk|acoustic/i,{ e: 0.35, h: 0.55, d: 0.40, a: 0.85, t: 95 }],
  [/classical|jazz/i,    { e: 0.30, h: 0.50, d: 0.30, a: 0.85, t: 85 }],
  [/pop/i,               { e: 0.70, h: 0.70, d: 0.70, a: 0.20, t: 112 }],
];
// iTunes genre -> your own genre names (first of your genres that matches is used)
const ITUNES_TO_DB = [
  [/hip|rap/i,            /hip|rap|trap/i],
  [/r&b|soul/i,           /r&b|rnb|soul/i],
  [/dance|electro/i,      /electro|edm|dance/i],
  [/rock|alt|metal|punk/i,/rock|metal|punk|alt/i],
  [/singer|folk|acoustic/i,/acoustic|folk|indie/i],
  [/classical/i,          /classical|orchestra/i],
  [/jazz|blues/i,         /jazz|blues/i],
  [/country/i,            /country/i],
  [/reggae/i,             /reggae/i],
  [/latin/i,              /latin/i],
  [/pop/i,                /^pop$|pop hits|^pop/i],
];

// Videos like these are not the song. A word is ignored if the iTunes title itself has it (a real "Remix").
const BAD_VIDEO = /\b(tutorial|lesson|lessons|learn to|how to|karaoke|instrumental|cover|covered|reaction|reacts?|chords?|tabs|slowed|reverb|sped up|nightcore|8d|mashup|remix|jukebox|interview|behind the scenes|making of|trailer|teaser|full album|top \d+|best of)\b/gi;

// ---------- small helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round3 = (x) => Math.round(x * 1000) / 1000;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const unit = (s) => parseInt(createHash('md5').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff;
const jitter = (key, amount) => (unit(key) - 0.5) * 2 * amount;
const cut = (s, n) => String(s ?? '').slice(0, n);
const warn = (m) => console.warn(`  ! ${m}`);
const decode = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

function isoToSec(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
// "Song (feat. X) - Remastered" -> "song"
const baseKey = (title) => norm(String(title || '').replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/\s+-\s+.*$/, ''));

// ---------- iTunes ----------
async function itunesSongs(artist) {
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({
    term: artist, media: 'music', entity: 'song', attribute: 'artistTerm', limit: '50', country: ITUNES_COUNTRY,
  }).toString();
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch (e) { if (attempt === 3) throw e; await sleep(3000); continue; }
    if (res.status === 403 || res.status === 429 || res.status >= 500) { await sleep(6000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`iTunes ${res.status}`);
    const j = await res.json().catch(() => ({}));
    const want = norm(artist);
    const seen = new Set();
    const out = [];
    for (const r of j.results || []) {
      if (r.kind !== 'song' || !r.trackName || !norm(r.artistName).includes(want)) continue;
      const key = baseKey(r.trackName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: String(r.trackName), key,
        album: r.collectionName || r.trackName,
        year: parseInt(String(r.releaseDate || '').slice(0, 4), 10) || null,
        genre: r.primaryGenreName || '',
        sec: Math.round((Number(r.trackTimeMillis) || 0) / 1000),
        cover: r.artworkUrl100 ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null,
      });
    }
    return out;
  }
  throw new Error('iTunes kept refusing (rate limit). Wait a few minutes and run again.');
}

// ---------- Last.fm ----------
let lfmErrShown = false;
let lfmDebug = 4;
async function lastfmTags(method, params) {
  if (!LASTFM_KEY) return [];
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  for (const [k, v] of Object.entries({ method, api_key: LASTFM_KEY, format: 'json', autocorrect: '1', ...params })) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    await sleep(230);
    if (!res.ok) { if (!lfmErrShown) { lfmErrShown = true; warn(`Last.fm HTTP ${res.status} on ${method}`); } return []; }
    const j = await res.json();
    if (method.startsWith('track') && lfmDebug-- > 0)
      console.log(`\n  [Last.fm sample] "${params.track}" -> ${j.error ? `error ${j.error}: ${j.message}` : `${(j.toptags?.tag || []).length} tags`}`);
    if (j.error) {
      if (j.error !== 6 && !lfmErrShown) { lfmErrShown = true; warn(`Last.fm error ${j.error} on ${method}: ${j.message}`); }
      return [];
    }
    return (j.toptags?.tag || []).map((t) => ({ name: String(t.name).toLowerCase().trim(), count: Number(t.count) || 0 }));
  } catch { return []; }
}
async function checkLastfm() {
  if (!LASTFM_KEY) { console.log('Last.fm: no key, using the region from the artist list and the genre for features.'); return; }
  try {
    const url = new URL('https://ws.audioscrobbler.com/2.0/');
    for (const [k, v] of Object.entries({ method: 'artist.gettoptags', artist: 'BTS', api_key: LASTFM_KEY, format: 'json' })) url.searchParams.set(k, v);
    const j = await (await fetch(url)).json();
    if (j.error) { warn(`Last.fm key rejected (${j.message}). Continuing without Last.fm.`); LASTFM_KEY = ''; }
    else console.log('Last.fm: key works.');
  } catch (e) { warn(`Last.fm unreachable (${e.message}). Continuing without it.`); LASTFM_KEY = ''; }
}
function regionFromTags(tags, hint) {
  const top = {};
  for (const t of tags) { const r = TAG_REGION[t.name]; if (r) top[r] = Math.max(top[r] || 0, t.count); }
  const best = Object.entries(top).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 10) return null;
  // "indian" is a broad tag that Punjabi artists also get. A clear punjabi tag wins over it.
  if ((top.punjabi || 0) >= 0.5 * best[1]) return 'punjabi';
  // artist list says punjabi and the only competing tag is the broad "indian": trust the list
  if (best[0] === 'indian' && hint === 'punjabi') return 'punjabi';
  return best[0];
}

// ---------- YouTube ----------
const YT = 'https://www.googleapis.com/youtube/v3';
let units = 0, quotaHit = false;
async function yt(path, params, cost) {
  const url = new URL(YT + path);
  for (const [k, v] of Object.entries({ ...params, key: YT_KEY })) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch (e) { if (attempt === 2) throw e; await sleep(1000 * (attempt + 1)); continue; }
    const json = await res.json().catch(() => ({}));
    if (res.ok) { units += cost; return json; }
    if (res.status >= 500 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
    const err = json.error || {};
    const reason = err.errors?.[0]?.reason || '';
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || /quota/i.test(err.message || '')) quotaHit = true;
    throw new Error(`YouTube API ${res.status}${reason ? ` (${reason})` : ''}: ${err.message || 'request failed'}`);
  }
}
// Search results are saved next to this script for 7 days, so a dry run and the real run cost the quota only once.
const CACHE_FILE = new URL('./.yt-search-cache.json', import.meta.url);
let searchCache = {};
try { searchCache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* no cache yet */ }
async function searchVideos(q) {
  const hit = searchCache[q];
  if (!FRESH && hit && Date.now() - hit.t < 7 * 86400000) return hit.list;
  const j = await yt('/search', { part: 'snippet', q, type: 'video', videoCategoryId: '10', videoEmbeddable: 'true', maxResults: 50 }, 100);
  const list = (j.items || []).filter((i) => i.id?.videoId).map((i) => ({ id: i.id.videoId, title: decode(i.snippet.title), channel: decode(i.snippet.channelTitle) }));
  searchCache[q] = { t: Date.now(), list };
  try { writeFileSync(CACHE_FILE, JSON.stringify(searchCache)); } catch { /* cache is optional */ }
  return list;
}
async function fetchDetails(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const j = await yt('/videos', { part: 'snippet,contentDetails,statistics,status', id: ids.slice(i, i + 50).join(',') }, 1);
      for (const v of j.items || []) out.set(v.id, v);
    } catch (e) { warn(`details request failed: ${e.message}`); }
  }
  return out;
}
function usable(v) {
  const sn = v.snippet || {}, cd = v.contentDetails || {}, st = v.status || {};
  const dur = isoToSec(cd.duration);
  if (dur < MIN_SEC || dur > MAX_SEC) return false;
  if (st.embeddable === false || (st.privacyStatus && st.privacyStatus !== 'public')) return false;
  if (sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none') return false;
  const rr = cd.regionRestriction;
  if (rr?.blocked?.includes(YT_REGION)) return false;
  if (rr?.allowed && !rr.allowed.includes(YT_REGION)) return false;
  return true;
}

// Find the best playable video for one iTunes track. Returns { video, score } or null.
function matchVideo(track, artist, candidates, used) {
  const wantArtist = norm(artist);
  let best = null;
  for (const c of candidates) {
    if (used.has(c.id)) continue;
    const text = `${c.title} ${c.channel}`;
    if (!norm(text).includes(wantArtist)) continue;
    // tutorial / cover / karaoke filter (ignores a word if the real iTunes title has it too)
    const bad = (text.match(BAD_VIDEO) || []).map((w) => w.toLowerCase());
    if (bad.some((w) => !track.title.toLowerCase().includes(w))) continue;
    if (track.sec && Math.abs(c.sec - track.sec) > DURATION_TOLERANCE) continue;

    const segs = c.title.split(/\s[-–—|｜]\s|\s*\|\s*/).map(baseKey).filter(Boolean);
    const exact = segs.includes(track.key);
    const wholeNorm = ` ${norm(c.title)} `;
    const wordHit = track.key.length >= 4 && wholeNorm.includes(` ${track.key} `);
    if (!exact && !wordHit) continue;
    const score = (exact ? 3 : 1) + Math.log10(c.views + 10) / 10;
    if (!best || score > best.score) best = { video: c, score };
  }
  return best;
}

// ---------- feature estimation ----------
function estimate(rec) {
  const p = (rec.region !== 'international' && REGION_PROFILE[rec.region])
    || (ITUNES_PROFILE.find(([re]) => re.test(rec.genre)) || [null, NEUTRAL])[1];
  let e = p.e, h = p.h, d = p.d, a = p.a, t = p.t;
  const k = rec.videoId;
  e += jitter(k + 'e', 0.08); h += jitter(k + 'h', 0.10); d += jitter(k + 'd', 0.08); a += jitter(k + 'a', 0.08); t += jitter(k + 't', 10);
  const hits = [];
  for (const tag of rec.tags) {
    for (const [re, adj] of MOOD_TAGS) {
      if (!re.test(tag.name)) continue;
      const w = clamp(tag.count / 60, 0.3, 1);
      e += (adj.e || 0) * w; h += (adj.h || 0) * w; d += (adj.d || 0) * w; a += (adj.a || 0) * w; t += (adj.t || 0) * w;
      hits.push(tag.name);
      break;
    }
  }
  if (!hits.length) {
    const words = norm(rec.title);
    for (const [re, label, adj] of TITLE_MOOD) {
      if (!re.test(words)) continue;
      e += adj.e || 0; h += adj.h || 0; d += adj.d || 0; t += adj.t || 0;
      hits.push(`title:${label}`);
      break;
    }
  }
  rec.moodTags = hits;
  return {
    energy: round3(clamp(e, 0, 1)), happiness: round3(clamp(h, 0, 1)), tempo: Math.round(clamp(t, 40, 220)),
    danceability: round3(clamp(d, 0, 1)), acousticness: round3(clamp(a, 0, 1)),
  };
}

// ---------- main ----------
async function main() {
  if (!YT_KEY) { console.error('No YouTube key. Put YOUTUBE_API_KEY in .env (the same key import-youtube.mjs uses).'); process.exit(1); }
  if (!process.env.DB_USER || !process.env.DB_PASSWORD) { console.error('DB_USER / DB_PASSWORD missing. Run this from moodtide-backend/server.'); process.exit(1); }
  await checkLastfm();

  let artists = ARTISTS.slice();
  if (EXTRA) {
    const [n, r = 'international'] = EXTRA.split(':');
    artists = [[n.trim(), r.trim().toLowerCase(), null]];
  } else if (ONLY) artists = artists.filter((a) => a[1] === ONLY);
  if (!artists.length) { console.error('No artists selected. --only takes: punjabi, indian, korean or japanese.'); process.exit(1); }

  const pool = await new sql.ConnectionPool(config).connect();
  try {
    // ----- preflight: table names and the region CHECK constraint -----
    const sg = await run(pool, `SELECT name FROM sys.tables WHERE name IN ('song_genres','song_genre')`);
    if (!sg.length) throw new Error('Could not find a song_genres or song_genre table.');
    const SG = sg[0].name;
    const cons = await run(pool, `SELECT name, definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('dbo.songs')`);
    const regionCon = cons.filter((c) => /region/i.test(c.definition));
    const needed = new Set(artists.map((a) => a[1]).concat(['international']));
    for (const c of regionCon) {
      const missing = [...needed].filter((r) => !c.definition.toLowerCase().includes(`'${r}'`));
      if (missing.length) {
        console.error(`The CHECK constraint ${c.name} on dbo.songs.region does not allow: ${missing.join(', ')}`);
        console.error(`Definition: ${c.definition}`);
        console.error('Drop it or recreate it with the new values, for example:');
        console.error(`  ALTER TABLE dbo.songs DROP CONSTRAINT ${c.name};`);
        console.error(`  ALTER TABLE dbo.songs ADD CONSTRAINT ${c.name} CHECK (region IN (${['pakistani', 'international', 'punjabi', 'indian', 'korean', 'japanese'].map((x) => `'${x}'`).join(', ')}));`);
        process.exit(1);
      }
    }

    const dbGenres = await run(pool, 'SELECT genre_id, name FROM dbo.genres ORDER BY name');
    const pickDbGenre = (itunesGenre) => {
      for (const [ire, dre] of ITUNES_TO_DB) {
        if (!ire.test(itunesGenre)) continue;
        const hit = dbGenres.filter((g) => dre.test(g.name)).sort((a, b) => a.name.length - b.name.length)[0];
        if (hit) return hit.genre_id;
      }
      return null;
    };
    const regionGenre = new Map(); // region -> { id, create }
    for (const [reg, name] of Object.entries(REGION_GENRE)) {
      const found = dbGenres.find((g) => norm(g.name) === norm(name) || (reg === 'pakistani' && /pakistan|desi/i.test(g.name)));
      regionGenre.set(reg, found ? { id: found.genre_id, name: found.name, create: false } : { id: `gen_${reg}`, name, create: true });
    }
    const fallbackGenre = (dbGenres.find((g) => /^pop$/i.test(g.name)) || dbGenres[0] || {}).genre_id;

    console.log(`${artists.length} artists, up to ${PER_ARTIST} songs each, iTunes store ${ITUNES_COUNTRY}.`);
    console.log(`YouTube quota for this run: about ${artists.length * SEARCHES * 100} units.${DRY_RUN ? '  (dry run: nothing is saved)' : ''}\n`);

    const records = [];
    const usedVideos = new Set();

    for (const [artist, hint, country] of artists) {
      if (quotaHit) { warn('YouTube quota is used up, stopping early'); break; }
      process.stdout.write(`${artist.padEnd(20)} `);

      // 1) iTunes: real songs with year / genre / art
      let tracks = [];
      try { tracks = await itunesSongs(artist); } catch (e) { console.log(`iTunes failed: ${e.message}`); continue; }
      await sleep(3200); // iTunes allows roughly 20 requests a minute
      if (!tracks.length) { console.log('iTunes found no songs'); continue; }

      // 2) YouTube: candidate videos, then details (length, embeddable, region)
      let found = [];
      const queries = [`${artist} official music video`, `${artist} songs`].slice(0, SEARCHES);
      for (const q of queries) {
        try { found = found.concat(await searchVideos(q)); } catch (e) { warn(`search "${q}": ${e.message}`); if (quotaHit) break; }
      }
      const ids = [...new Set(found.map((f) => f.id))];
      const details = await fetchDetails(ids);
      const candidates = found.filter((f, i) => found.findIndex((x) => x.id === f.id) === i).map((f) => {
        const v = details.get(f.id);
        return v && usable(v) ? { ...f, sec: isoToSec(v.contentDetails.duration), views: Number(v.statistics?.viewCount) || 0 } : null;
      }).filter(Boolean);

      // 3) match each iTunes track to a video
      const matched = [];
      for (const tr of tracks) {
        const m = matchVideo(tr, artist, candidates, usedVideos);
        if (!m) continue;
        usedVideos.add(m.video.id);
        matched.push({ tr, video: m.video });
        if (matched.length >= PER_ARTIST) break;
      }

      // 4) Last.fm tags: artist once, then each matched track
      const artistTags = await lastfmTags('artist.gettoptags', { artist });
      const artistRegion = regionFromTags(artistTags, hint);
      let tagged = 0;
      for (const { tr, video } of matched) {
        let trackTags = await lastfmTags('track.gettoptags', { artist, track: tr.title });
        if (!trackTags.length) {
          // retry without "(feat. ...)" / "- From ..." which Last.fm often does not have
          const plain = tr.title.replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/\s+-\s+.*$/, '').trim();
          if (plain && plain !== tr.title) trackTags = await lastfmTags('track.gettoptags', { artist, track: plain });
        }
        const tags = trackTags.length ? trackTags : artistTags;
        const region = regionFromTags(trackTags, hint) || artistRegion || hint || 'international';
        if (trackTags.length) tagged++;
        records.push({
          artist, country, region, tags,
          videoId: video.id, sec: video.sec, views: video.views,
          title: tr.title, album: tr.album, year: tr.year, genre: tr.genre, cover: tr.cover,
        });
      }
      console.log(`iTunes ${String(tracks.length).padStart(2)} | videos ${String(candidates.length).padStart(2)} | matched ${String(matched.length).padStart(2)}${LASTFM_KEY ? ` | track tags ${tagged}` : ''}${artistRegion ? ` | artist tag region: ${artistRegion}` : ''}`);
    }

    // ----- summary -----
    const byRegion = {};
    for (const r of records) byRegion[r.region] = (byRegion[r.region] || 0) + 1;
    console.log(`\nSongs ready: ${records.length}  by region: ${JSON.stringify(byRegion)}   (YouTube units used: about ${units})`);
    if (DRY_RUN) {
      for (const r of records.slice(0, 12)) {
        const f = estimate(r);
        console.log(`  [${r.region}] ${r.artist} - ${r.title} (${r.year ?? '?'}, ${r.genre})  mood tags: ${r.moodTags.join(', ') || 'none'}  e=${f.energy} h=${f.happiness} t=${f.tempo}`);
      }
      return;
    }
    if (!records.length) { console.error('Nothing matched, so nothing was saved. Read the "!" lines above.'); process.exitCode = 1; return; }

    // ----- save in one transaction (same upsert pattern as import-youtube.mjs) -----
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const rg of regionGenre.values()) {
        if (rg.create && records.some((r) => r.region === Object.keys(REGION_GENRE).find((k) => REGION_GENRE[k] === rg.name)))
          await run(tx, `IF NOT EXISTS (SELECT 1 FROM dbo.genres WHERE genre_id = @id) INSERT INTO dbo.genres (genre_id, name) VALUES (@id, @name)`,
            { id: rg.id, name: [sql.NVarChar(200), rg.name] });
      }

      let saved = 0, updated = 0;
      for (const t of records) {
        const artistKey = createHash('md5').update(norm(t.artist)).digest('hex').slice(0, 12);
        const artistId = `yta_${artistKey}`;
        await run(tx,
          `UPDATE dbo.artists SET name = @name, country = COALESCE(@country, country) WHERE artist_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.artists (artist_id, name, country, source, external_id)
             VALUES (@id, @name, @country, N'youtube', @ext);`,
          { id: artistId, name: [sql.NVarChar(300), cut(t.artist, 300)], country: [sql.NVarChar(100), t.country], ext: artistKey });

        // reuse the song row if this artist + title already exists (from an older import), so there are no duplicates
        const existing = await run(tx,
          `SELECT TOP 1 song_id, album_id FROM dbo.songs WHERE artist_id = @a AND LOWER(title) = LOWER(@t)`,
          { a: artistId, t: [sql.NVarChar(500), cut(t.title, 500)] });
        const songId = existing[0]?.song_id ?? `yt_${t.videoId}`;
        const albumId = existing[0]?.album_id ?? `ytb_${t.videoId}`;
        const popularity = clamp(Math.round((Math.log10(t.views + 1) - 3) * 16), 5, 100);
        const watchUrl = `https://www.youtube.com/watch?v=${t.videoId}`;

        await run(tx,
          `UPDATE dbo.albums SET title = @title, release_year = COALESCE(@year, release_year), cover_url = COALESCE(@cover, cover_url) WHERE album_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.albums (album_id, artist_id, title, release_year, cover_url, source, external_id)
             VALUES (@id, @artist, @title, @year, @cover, N'youtube', @ext);`,
          { id: albumId, artist: artistId, title: [sql.NVarChar(400), cut(t.album, 400)], year: [sql.Int, t.year],
            cover: [sql.NVarChar(1000), t.cover], ext: t.videoId });

        await run(tx,
          `UPDATE dbo.songs SET release_year = COALESCE(@year, release_year), region = @region, popularity = @pop,
                                external_url = @link, is_active = 1 WHERE song_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.songs (song_id, artist_id, album_id, title, duration_sec, release_year, audio_url,
                                    popularity, is_active, source, external_id, external_url, region)
             VALUES (@id, @artist, @album, @title, @dur, @year, NULL, @pop, 1, N'youtube', @ext, @link, @region);`,
          { id: songId, artist: artistId, album: albumId, title: [sql.NVarChar(500), cut(t.title, 500)],
            dur: [sql.Int, t.sec], year: [sql.Int, t.year], pop: [sql.Int, popularity], ext: t.videoId,
            link: [sql.NVarChar(1000), watchUrl], region: [sql.NVarChar(50), t.region] });
        if (existing[0]) updated++; else saved++;

        const f = estimate(t);
        await run(tx,
          `UPDATE dbo.song_features SET energy = @e, happiness = @h, tempo = @t, danceability = @d, acousticness = @a WHERE song_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.song_features (song_id, energy, happiness, tempo, danceability, acousticness, feature_source)
             VALUES (@id, @e, @h, @t, @d, @a, N'estimated');`,
          { id: songId, e: [sql.Float, f.energy], h: [sql.Float, f.happiness], t: [sql.Int, f.tempo],
            d: [sql.Float, f.danceability], a: [sql.Float, f.acousticness] });

        const genreIds = new Set();
        if (t.region !== 'international' && regionGenre.has(t.region)) genreIds.add(regionGenre.get(t.region).id);
        const dbg = pickDbGenre(t.genre);
        if (dbg) genreIds.add(dbg);
        if (!genreIds.size && fallbackGenre) genreIds.add(fallbackGenre);
        for (const gid of genreIds)
          await run(tx,
            `IF NOT EXISTS (SELECT 1 FROM dbo.${SG} WHERE song_id = @s AND genre_id = @g) INSERT INTO dbo.${SG} (song_id, genre_id) VALUES (@s, @g)`,
            { s: songId, g: gid });
      }
      await tx.commit();
      console.log(`\nSaved ${saved} new songs, updated ${updated} existing ones.`);
      if (quotaHit) console.log('Note: the YouTube quota ran out, so some artists were skipped. Run again tomorrow.');
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  } catch (e) {
    console.error('\nImport failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.close();
  }
}

main();
