#!/usr/bin/env node
// =====================================================================
// MoodTide PART 2: build a better catalog from three sources (PostgreSQL).
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
//   node scripts/import-catalog.mjs --genre ghazal,qawwali    (one or more genres from scripts/lib/artists.js)
//   node scripts/import-catalog.mjs --only punjabi            (one region: pakistani|punjabi|indian|korean|japanese|international)
//   node scripts/import-catalog.mjs --artist "Sidhu Moose Wala:punjabi:punjabi_pop"   (one extra artist: name:region:genre)
//   node scripts/import-catalog.mjs --per-artist 20 --searches 2
//   node scripts/import-catalog.mjs --no-lastfm               (skip Last.fm, use the region of the artist list)
//   node scripts/import-catalog.mjs --country PK              (iTunes store; default US, has the biggest catalog)
//   node scripts/import-catalog.mjs --fresh                   (ignore the saved YouTube search results)
//
// .env needs: YOUTUBE_API_KEY and the DB_* settings (or DATABASE_URL), same as the server.
// and optionally: LASTFM_API_KEY
// The artist lists, one per genre, are in scripts/lib/artists.js (task A16). The day-by-day quota plan is docs/import-schedule.xlsx.
// Shared code lives in scripts/lib/ (task A15): flags, cache, YouTube client, duplicate detection,
// saving, the bad-video filter, length class.
//
// QUOTA: one YouTube search = 100 units (free limit 10,000/day). Default is 1 search per artist.
// Search results are cached for 7 days, so a dry run and the real run cost the quota only once.
//
// Running it twice never creates duplicates. A song is matched by (source, video id) and by
// normalised artist + title. If the same song is already saved from YouTube under another video id,
// its year, region, cover and genres are filled in and its row is kept.
//
// HONEST NOTE: energy / happiness / tempo are still ESTIMATES. They start from the genre and are
// nudged by Last.fm mood tags ("sad", "chill", "party"). Tags are real data, tempo is not measured.
// Songs are saved with feature_source = 'estimated'.
// =====================================================================
import 'dotenv/config';
import { query, withTx, runScript } from './lib/db.js';
import { getFlags } from './lib/flags.js';
import { createYouTube, isUsableVideo } from './lib/youtube.js';
import { loadCatalogIndex } from './lib/dedupe.js';
import { saveSong } from './lib/save.js';
import { badVideoWords } from './lib/filters.js';
import { norm, baseKey, hasWords, isoToSec } from './lib/normalize.js';
import { sleep, clamp, round3, jitter, warn, popularityFromViews } from './lib/util.js';
import { ARTISTS, GENRE_IDS } from './lib/artists.js';

// ---------- command line ----------
const { has, opt, int, dryRun: DRY_RUN, fresh: FRESH } = getFlags();
const PER_ARTIST = int('per-artist', 12, 1, 1000);
const SEARCHES = int('searches', 1, 1, 2);
const ONLY = String(opt('only', '')).toLowerCase();
const GENRES = String(opt('genre', '')).toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
const EXTRA = String(opt('artist', ''));
const ITUNES_COUNTRY = String(opt('country', 'US')).toUpperCase();
const YT_REGION = String(opt('region', 'PK')).toUpperCase(); // hide videos blocked in this country
const YT_KEY = opt('key', process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || '');
let LASTFM_KEY = has('no-lastfm') ? '' : opt('lastfm-key', process.env.LASTFM_API_KEY || '');
const DURATION_TOLERANCE = 45; // iTunes length vs YouTube length, in seconds
const MIN_SEC = 60, MAX_SEC = 600;

const ITUNES_API = process.env.ITUNES_API_BASE || 'https://itunes.apple.com';             // override only for tests
const LASTFM_API = process.env.LASTFM_API_BASE || 'https://ws.audioscrobbler.com/2.0/';   // override only for tests

// Last.fm tag -> region. Counts of all tags for a region are added up, the biggest wins.
const TAG_REGION = {
  punjabi: 'punjabi', bhangra: 'punjabi', 'punjabi pop': 'punjabi', 'punjabi music': 'punjabi',
  pakistani: 'pakistani', pakistan: 'pakistani', urdu: 'pakistani', qawwali: 'pakistani',
  bollywood: 'indian', hindi: 'indian', indian: 'indian', 'hindi pop': 'indian',
  'k-pop': 'korean', kpop: 'korean', korean: 'korean',
  'j-pop': 'japanese', jpop: 'japanese', japanese: 'japanese', 'j-rock': 'japanese', anime: 'japanese',
};

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

// ---------- iTunes ----------
async function itunesSongs(artist) {
  const url = new URL(`${ITUNES_API}/search`);
  url.search = new URLSearchParams({
    term: artist, media: 'music', entity: 'song', attribute: 'artistTerm', limit: '50', country: ITUNES_COUNTRY,
  }).toString();
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch (e) { if (attempt === 3) throw e; await sleep(3000); continue; }
    if (res.status === 403 || res.status === 429 || res.status >= 500) { await sleep(6000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`iTunes ${res.status}`);
    const j = await res.json().catch(() => ({}));
    const seen = new Set();
    const out = [];
    for (const r of j.results || []) {
      if (r.kind !== 'song' || !r.trackName || !hasWords(r.artistName, artist)) continue;
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
  const url = new URL(LASTFM_API);
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
    const url = new URL(LASTFM_API);
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

// Find the best playable video for one iTunes track. Returns { video, score } or null.
function matchVideo(track, artist, candidates, used) {
  let best = null;
  for (const c of candidates) {
    if (used.has(c.id)) continue;
    const text = `${c.title} ${c.channel}`;
    if (!hasWords(text, artist)) continue;
    // tutorial / cover / karaoke filter (a word is ignored if the real iTunes title has it too)
    if (badVideoWords(text, { profile: 'music', trackTitle: track.title }).length) continue;
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
export function estimate(rec) {
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
  const yt = createYouTube({ key: YT_KEY, fresh: FRESH });
  await checkLastfm();

  let artists = ARTISTS.slice();   // [name, region, country, genreKey]
  if (EXTRA) {
    const [n, r = 'international', g = ''] = EXTRA.split(':');
    artists = [[n.trim(), r.trim().toLowerCase(), null, g.trim().toLowerCase()]];
  } else {
    const badGenre = GENRES.find((g) => !GENRE_IDS[g]);
    if (badGenre) { console.error(`--genre "${badGenre}" is not known. Choose from: ${Object.keys(GENRE_IDS).join(', ')}`); process.exit(1); }
    if (GENRES.length) artists = artists.filter((a) => GENRES.includes(a[3]));
    if (ONLY) artists = artists.filter((a) => a[1] === ONLY);
  }
  if (!artists.length) { console.error('No artists selected. Check --genre and --only (regions: pakistani, punjabi, indian, korean, japanese, international).'); process.exit(1); }
  if (EXTRA && EXTRA.split(':')[2] && !GENRE_IDS[artists[0][3]]) { console.error(`The genre "${artists[0][3]}" is not known. Choose from: ${Object.keys(GENRE_IDS).join(', ')}`); process.exit(1); }

  // ----- your genres (used to map iTunes genres). A dry run may go on without the database. -----
  let dbGenres = [], dbOk = true;
  try {
    // the Islamic categories have their own importer: never map music into them
    dbGenres = (await query('SELECT genre_id, name FROM genres ORDER BY name')).filter((g) => !g.genre_id.startsWith('gen_isl_'));
  } catch (e) {
    dbOk = false;
    if (!DRY_RUN) { console.error(`Cannot read the database: ${e.message}`); process.exitCode = 1; return; }
    warn(`database not available (${e.message}). The dry run shows no genre mapping.`);
  }
  const pickDbGenre = (itunesGenre) => {
    for (const [ire, dre] of ITUNES_TO_DB) {
      if (!ire.test(itunesGenre)) continue;
      const hit = dbGenres.filter((g) => dre.test(g.name)).sort((a, b) => a.name.length - b.name.length)[0];
      if (hit) return hit.genre_id;
    }
    return null;
  };
  // the genres of the selected artists must exist (db/init/03_genres.sql creates them)
  const known = new Set(dbGenres.map((g) => g.genre_id));
  const missing = [...new Set(artists.map((a) => GENRE_IDS[a[3]]).filter((id) => id && !known.has(id)))];
  if (missing.length) {
    const msg = `these genres are not in the database: ${missing.join(', ')}. Run db/init/03_genres.sql first.`;
    if (!DRY_RUN) { console.error(`Stopped: ${msg}`); process.exitCode = 1; return; }
    warn(msg);
  }
  const fallbackGenre = (dbGenres.find((g) => /^pop$/i.test(g.name)) || dbGenres[0] || {}).genre_id;

  console.log(`${artists.length} artists, up to ${PER_ARTIST} songs each, iTunes store ${ITUNES_COUNTRY}.`);
  console.log(`YouTube quota for this run: at most about ${artists.length * SEARCHES * 100} units (searches saved in the cache cost nothing).${DRY_RUN ? '  (dry run: nothing is saved)' : ''}\n`);

  const records = [];
  const usedVideos = new Set();

  for (const [artist, hint, country, genreKey] of artists) {
    if (yt.quotaHit) { warn('YouTube quota is used up, stopping early'); break; }
    process.stdout.write(`${artist.padEnd(20)} `);

    // 1) iTunes: real songs with year / genre / art
    let tracks = [];
    try { tracks = await itunesSongs(artist); } catch (e) { console.log(`iTunes failed: ${e.message}`); continue; }
    await sleep(ITUNES_API === 'https://itunes.apple.com' ? 3200 : 0); // iTunes allows roughly 20 requests a minute
    if (!tracks.length) { console.log('iTunes found no songs'); continue; }

    // 2) YouTube: candidate videos, then details (length, embeddable, region)
    let found = [];
    const queries = [`${artist} official music video`, `${artist} songs`].slice(0, SEARCHES);
    for (const q of queries) {
      try { found = found.concat(await yt.search(q, { extra: { videoCategoryId: '10' }, cacheKey: q })); }
      catch (e) { warn(`search "${q}": ${e.message}`); if (yt.quotaHit) break; }
    }
    const ids = [...new Set(found.map((f) => f.id))];
    const details = await yt.details(ids);
    const candidates = found.filter((f, i) => found.findIndex((x) => x.id === f.id) === i).map((f) => {
      const v = details.get(f.id);
      return v && isUsableVideo(v, { minSec: MIN_SEC, maxSec: MAX_SEC, region: YT_REGION })
        ? { ...f, sec: isoToSec(v.contentDetails.duration), views: Number(v.statistics?.viewCount) || 0 } : null;
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
        const plain = tr.title.replace(/\s*[(\[].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim();
        if (plain && plain !== tr.title) trackTags = await lastfmTags('track.gettoptags', { artist, track: plain });
      }
      const tags = trackTags.length ? trackTags : artistTags;
      const region = regionFromTags(trackTags, hint) || artistRegion || hint || 'international';
      if (trackTags.length) tagged++;
      records.push({
        artist, country, region, tags, genreKey,
        videoId: video.id, sec: video.sec, views: video.views,
        title: tr.title, album: tr.album, year: tr.year, genre: tr.genre, cover: tr.cover,
      });
    }
    console.log(`iTunes ${String(tracks.length).padStart(2)} | videos ${String(candidates.length).padStart(2)} | matched ${String(matched.length).padStart(2)}${LASTFM_KEY ? ` | track tags ${tagged}` : ''}${artistRegion ? ` | artist tag region: ${artistRegion}` : ''}`);
  }

  // ----- summary -----
  const byRegion = {};
  for (const r of records) byRegion[r.region] = (byRegion[r.region] || 0) + 1;
  console.log(`\nSongs ready: ${records.length}  by region: ${JSON.stringify(byRegion)}   (YouTube units used: about ${yt.units})`);
  if (DRY_RUN) {
    for (const r of records.slice(0, 12)) {
      const f = estimate(r);
      console.log(`  [${r.region}/${r.genreKey || '-'}] ${r.artist} - ${r.title} (${r.year ?? '?'}, ${r.genre})  mood tags: ${r.moodTags.join(', ') || 'none'}  e=${f.energy} h=${f.happiness} t=${f.tempo}`);
    }
    return;
  }
  if (!records.length) { console.error('Nothing matched, so nothing was saved. Read the "!" lines above.'); process.exitCode = 1; return; }

  // ----- save in one transaction (shared saveSong: no duplicates on a second run) -----
  const result = await withTx(async (tx) => {
    const index = await loadCatalogIndex(tx);
    const counts = { inserted: 0, updated: 0, duplicate: 0, skipped: 0 };
    for (const t of records) {
      // the artist's own genre first, then the genre iTunes names for the song (at most two genres per song)
      const genreIds = new Set();
      const own = GENRE_IDS[t.genreKey];
      if (own && known.has(own)) genreIds.add(own);
      const dbg = pickDbGenre(t.genre);
      if (dbg && genreIds.size < 2) genreIds.add(dbg);
      if (!genreIds.size && fallbackGenre) genreIds.add(fallbackGenre);

      const link = `https://www.youtube.com/watch?v=${t.videoId}`;
      const out = await saveSong(tx, index, {
        source: 'youtube', externalId: t.videoId, title: t.title, durationSec: t.sec, year: t.year,
        artist: { name: t.artist, country: t.country },
        album: { title: t.album, cover: t.cover },
        audioUrl: null, popularity: popularityFromViews(t.views), contentType: 'music', region: t.region,
        sourceUrl: link, externalUrl: link,
        features: estimate(t), featureSource: 'estimated', genreIds: [...genreIds],
      }, { onNameMatch: 'enrich' });
      counts[out.action] = (counts[out.action] || 0) + 1;
    }
    return counts;
  });
  console.log(`\nSaved ${result.inserted} new songs, updated ${result.updated} existing ones` +
    `${result.duplicate + result.skipped ? `, left ${result.duplicate + result.skipped} alone (already saved under another source, or in the other section)` : ''}.`);
  if (yt.quotaHit) console.log('Note: the YouTube quota ran out, so some artists were skipped. Run again tomorrow.');
}

// MOODTIDE_NO_RUN lets tests import estimate() without starting the import
if (!process.env.MOODTIDE_NO_RUN) runScript(main);
