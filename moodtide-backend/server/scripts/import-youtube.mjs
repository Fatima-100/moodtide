#!/usr/bin/env node
// =====================================================================
// MoodTide: import real songs from the YouTube Data API v3 into SQL SERVER.
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
//   node scripts/import-youtube.mjs --deactivate-demo   (hides songs with source = 'demo')
//
// Uses the same .env as the backend (DB_SERVER, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
// plus YOUTUBE_API_KEY.
//
// QUOTA: the free limit is 10,000 units per day. One search costs 100 units, one
// details request costs 1 unit. The script prints its plan before it starts.
//
// NOTE: YouTube gives no energy / happiness / tempo numbers, so those are estimated
// from the genre (same idea as before). Songs are saved with a link to YouTube
// (external_url) and the video id (external_id). Play them with the official YouTube
// embedded player. Do not download audio from YouTube.
// =====================================================================
import 'dotenv/config';
import sql from 'mssql';
import { createHash } from 'node:crypto';

// ---------- command line ----------
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PER_GENRE = Math.max(1, parseInt(opt('per-genre', '25'), 10) || 25);
const PER_ARTIST = Math.max(1, parseInt(opt('per-artist', '6'), 10) || 6);
const DRY_RUN = has('dry-run');
const NO_PAKISTANI = has('no-pakistani');
const DEACTIVATE_DEMO = has('deactivate-demo');
const REGION = String(opt('region', 'PK')).toUpperCase();
const API_KEY = opt('key', process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || process.env.GOOGLE_API_KEY || '');
const MIN_SEC = 45;   // shorter than this is not a song
const MAX_SEC = 900;  // longer than 15 minutes is usually a mix or a full album

// ---------- database connection (same settings as src/db.js) ----------
const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'MoodTide',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

// Run one query. A param is either a plain value, or [sqlType, value] when the type matters.
async function run(target, text, params = {}) {
  const req = target.request ? target.request() : new sql.Request(target);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) req.input(k, v[0], v[1]);
    else req.input(k, v);
  }
  const result = await req.query(text);
  return result.recordset ?? [];
}

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

// ---------- small helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round3 = (x) => Math.round(x * 1000) / 1000;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const unit = (s) => parseInt(createHash('md5').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff; // 0..1, same text -> same number
const jitter = (key, amount) => (unit(key) - 0.5) * 2 * amount;
const cut = (s, n) => String(s ?? '').slice(0, n);
const warn = (m) => console.warn(`  ! ${m}`);

// "PT3M45S" -> 225
export function isoToSec(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

// YouTube sends titles with HTML codes like &amp; and &#39;
const decode = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');

// Remove "(Official Video)", "[Lyrics]", "| Some Channel" and similar noise from a title
const NOISE = /\s*[\(\[\{][^\)\]\}]*(official|video|audio|lyric|visuali[sz]er|\bhd\b|4k|\bmv\b|m\/v|remaster|full song|live)[^\)\]\}]*[\)\]\}]/gi;
export function cleanTitle(s) {
  let t = decode(s).replace(NOISE, '').split(/\s[|｜]\s/)[0];
  t = t.replace(/\s+(official\s+(music\s+)?video|official audio|lyric video|lyrics?)\s*$/i, '');
  return t.replace(/\s{2,}/g, ' ').trim();
}
const cleanChannel = (c) =>
  decode(c).replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').replace(/\s*Official$/i, '').trim() || 'Unknown artist';

// "Artist - Song (Official Video)" -> { artist, title }. No dash -> use the channel name as the artist.
export function parseArtistTitle(rawTitle, channel) {
  const t = cleanTitle(rawTitle);
  const m = t.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: cleanChannel(channel), title: t };
}

// take items from each list in turn, skipping repeats, so one query can't dominate
export function interleave(lists) {
  const out = [], seen = new Set();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      if (i < l.length && !seen.has(l[i].id)) { seen.add(l[i].id); out.push(l[i]); }
    }
  }
  return out;
}

// ---------- YouTube client ----------
const YT = 'https://www.googleapis.com/youtube/v3';
let units = 0;
let quotaHit = false;
async function yt(path, params, cost) {
  const url = new URL(YT + path);
  for (const [k, v] of Object.entries({ ...params, key: API_KEY })) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) { units += cost; return json; }
    if (res.status >= 500 && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
    const err = json.error || {};
    const reason = err.errors?.[0]?.reason || '';
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') quotaHit = true;
    const e = new Error(`YouTube API ${res.status}${reason ? ` (${reason})` : ''}: ${err.message || 'request failed'}`);
    e.reason = reason;
    throw e;
  }
}

async function checkKey() {
  if (!API_KEY) {
    console.error('No YouTube API key found. Add  YOUTUBE_API_KEY=your_key  to moodtide-backend/server/.env  (or use --key YOUR_KEY).');
    process.exit(1);
  }
  try {
    await yt('/videos', { part: 'id', id: 'dQw4w9WgXcQ' }, 1);
  } catch (e) {
    console.error(`YouTube key check failed: ${e.message}`);
    console.error('Check: 1) the key is correct, 2) "YouTube Data API v3" is enabled in your Google Cloud project,');
    console.error('3) the key has no website (HTTP referrer) restriction, because this script runs on your computer, not in a browser.');
    process.exit(1);
  }
}

// one search = 100 quota units
async function searchVideos(q, duration) {
  const j = await yt('/search', {
    part: 'snippet', q, type: 'video', videoCategoryId: '10', videoEmbeddable: 'true',
    videoDuration: duration, maxResults: 50,
  }, 100);
  return (j.items || []).filter((i) => i.id && i.id.videoId).map((i) => ({ id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle }));
}

// details (duration, views, embeddable) for many ids, 50 per request = 1 unit each
async function fetchDetails(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const j = await yt('/videos', { part: 'snippet,contentDetails,statistics,status', id: chunk.join(',') }, 1);
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
  if (rr && rr.blocked && rr.blocked.includes(REGION)) return false;
  if (rr && rr.allowed && !rr.allowed.includes(REGION)) return false;
  return true;
}

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
  await checkKey();
  if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
    console.error('DB_USER / DB_PASSWORD are missing. Run this from moodtide-backend/server so it finds the backend .env file.');
    process.exit(1);
  }
  const pool = await new sql.ConnectionPool(config).connect();

  try {
    const dbGenres = await run(pool, 'SELECT genre_id, name FROM dbo.genres ORDER BY name');
    console.log(`Found ${dbGenres.length} genres in your database: ${dbGenres.map((g) => g.name).join(', ')}`);

    // ----- build the search groups: one per genre, one per Pakistani artist -----
    const groups = [];
    for (const g of dbGenres) {
      const plan = GENRE_PLAN.find((p) => p.match.test(g.name)) || { queries: [g.name], profile: NEUTRAL, fallback: true };
      if (plan.fallback) warn(`no preset for genre "${g.name}", searching for its name with neutral features`);
      groups.push({ label: g.name, genreId: g.genre_id, profile: plan.profile, queries: plan.queries,
        duration: 'short', limit: PER_GENRE, country: null, artist: null, items: [] });
    }
    let pkGenreId = (dbGenres.find((g) => /pakistan|desi/i.test(g.name)) || {}).genre_id;
    let createPkGenre = false;
    if (!NO_PAKISTANI) {
      if (!pkGenreId) { pkGenreId = 'gen_pakistani'; createPkGenre = true; }
      for (const [name, style] of PAKISTANI_ARTISTS) {
        groups.push({ label: name, genreId: pkGenreId, profile: STYLE[style], queries: [name],
          duration: 'any', limit: PER_ARTIST, country: 'PK', artist: name, items: [] });
      }
    }
    const planned = groups.reduce((a, g) => a + g.queries.length * 100, 0);
    console.log(`Plan: ${groups.length} search groups, about ${planned} quota units (free limit is 10,000 per day).`);
    console.log(DRY_RUN ? '(dry run: searches still use quota, but nothing is saved)\n' : '');

    // ----- 1) search -----
    for (const grp of groups) {
      if (quotaHit) { warn('quota is used up, stopping the search early'); break; }
      const lists = [];
      for (const q of grp.queries) {
        try { lists.push(await searchVideos(q, grp.duration)); }
        catch (e) { warn(`search "${q}": ${e.message}`); lists.push([]); if (quotaHit) break; }
      }
      let items = interleave(lists);
      // too few short videos? try one search for medium-length ones (4-20 minutes)
      if (grp.duration === 'short' && items.length < grp.limit + 5 && !quotaHit) {
        try { items = interleave([items, await searchVideos(grp.queries[0], 'medium')]); }
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
    const details = await fetchDetails(allIds);

    // ----- 3) pick the final songs -----
    const catalog = new Map(); // "artist|title" -> record
    for (const grp of groups) {
      let kept = 0;
      for (const it of grp.items) {
        if (kept >= grp.limit) break;
        const v = details.get(it.id);
        if (!v || !usable(v)) continue;
        const sn = v.snippet;
        const p = parseArtistTitle(sn.title, sn.channelTitle);
        const artist = grp.artist || p.artist;
        const title = grp.artist && !norm(p.artist).includes(norm(grp.artist)) ? cleanTitle(sn.title) : p.title;
        if (!title || !artist) continue;
        const key = `${norm(artist)}|${norm(title)}`;
        const existing = catalog.get(key);
        if (existing) { existing.genres.add(grp.genreId); kept++; continue; }
        const views = Number(v.statistics?.viewCount) || 0;
        const year = parseInt(String(sn.publishedAt || '').slice(0, 4), 10);
        catalog.set(key, {
          id: v.id, title, artist, country: grp.country,
          duration: isoToSec(v.contentDetails.duration),
          popularity: clamp(Math.round((Math.log10(views + 1) - 3) * 16), 5, 100),
          year: year >= 1900 && year <= 2100 ? year : null,
          thumb: (sn.thumbnails?.high || sn.thumbnails?.medium || sn.thumbnails?.default || {}).url || null,
          genres: new Set([grp.genreId]), profile: grp.profile,
        });
        kept++;
      }
      console.log(`${grp.label.padEnd(26)} kept: ${String(kept).padStart(3)}${kept === 0 ? '  (nothing usable)' : ''}`);
    }

    console.log(`\nTotal unique songs ready: ${catalog.size}   (quota used this run: about ${units} units)`);
    if (DRY_RUN) {
      for (const t of [...catalog.values()].slice(0, 6)) console.log(`  ${t.artist} - ${t.title}  ${JSON.stringify(estimate(t))}`);
      return;
    }
    if (catalog.size === 0) {
      console.error('Nothing found, so nothing was saved. Read the "!" lines above for the reason.');
      process.exitCode = 1;
      return;
    }

    // ----- 4) save everything in one transaction -----
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (createPkGenre && [...catalog.values()].some((t) => t.genres.has(pkGenreId))) {
        await run(tx,
          `IF NOT EXISTS (SELECT 1 FROM dbo.genres WHERE genre_id = @id)
             INSERT INTO dbo.genres (genre_id, name) VALUES (@id, N'Pakistani')`,
          { id: pkGenreId });
      }

      let saved = 0;
      for (const t of catalog.values()) {
        const artistKey = createHash('md5').update(norm(t.artist)).digest('hex').slice(0, 12);
        const artistId = `yta_${artistKey}`;
        await run(tx,
          `UPDATE dbo.artists SET name = @name, country = COALESCE(@country, country) WHERE artist_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.artists (artist_id, name, country, source, external_id)
             VALUES (@id, @name, @country, N'youtube', @ext);`,
          {
            id: artistId,
            name: [sql.NVarChar(300), cut(t.artist, 300)],
            country: [sql.NVarChar(100), t.country],
            ext: artistKey,
          });

        // YouTube has no albums, so each song gets a one-song "album" that holds its thumbnail
        const albumId = `ytb_${t.id}`;
        await run(tx,
          `UPDATE dbo.albums SET cover_url = COALESCE(@cover, cover_url) WHERE album_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.albums (album_id, artist_id, title, release_year, cover_url, source, external_id)
             VALUES (@id, @artist, @title, @year, @cover, N'youtube', @ext);`,
          {
            id: albumId,
            artist: artistId,
            title: [sql.NVarChar(400), cut(t.title, 400)],
            year: [sql.Int, t.year],
            cover: [sql.NVarChar(1000), t.thumb],
            ext: t.id,
          });

        const songId = `yt_${t.id}`;
        const watchUrl = `https://www.youtube.com/watch?v=${t.id}`;
        await run(tx,
          `UPDATE dbo.songs SET popularity = @pop, external_url = @link, is_active = 1 WHERE song_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.songs (song_id, artist_id, album_id, title, duration_sec, release_year, audio_url,
                                    popularity, is_active, source, external_id, external_url)
             VALUES (@id, @artist, @album, @title, @dur, @year, NULL, @pop, 1, N'youtube', @ext, @link);`,
          {
            id: songId,
            artist: artistId,
            album: albumId,
            title: [sql.NVarChar(500), cut(t.title, 500)],
            dur: [sql.Int, t.duration],
            year: [sql.Int, t.year],
            pop: [sql.Int, t.popularity],
            ext: t.id,
            link: [sql.NVarChar(1000), watchUrl],
          });

        const f = estimate(t);
        await run(tx,
          `UPDATE dbo.song_features
              SET energy = @e, happiness = @h, tempo = @t, danceability = @d, acousticness = @a
            WHERE song_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.song_features (song_id, energy, happiness, tempo, danceability, acousticness, feature_source)
             VALUES (@id, @e, @h, @t, @d, @a, N'estimated');`,
          {
            id: songId,
            e: [sql.Float, f.energy], h: [sql.Float, f.happiness], t: [sql.Int, f.tempo],
            d: [sql.Float, f.danceability], a: [sql.Float, f.acousticness],
          });

        for (const gid of t.genres) {
          await run(tx,
            `IF NOT EXISTS (SELECT 1 FROM dbo.song_genres WHERE song_id = @s AND genre_id = @g)
               INSERT INTO dbo.song_genres (song_id, genre_id) VALUES (@s, @g)`,
            { s: songId, g: gid });
        }
        saved++;
      }

      let hidden = 0;
      if (DEACTIVATE_DEMO) {
        const r = await new sql.Request(tx).query(`UPDATE dbo.songs SET is_active = 0 WHERE source = N'demo' AND is_active = 1`);
        hidden = r.rowsAffected[0] || 0;
      }
      await tx.commit();
      console.log(`\nSaved ${saved} songs.${DEACTIVATE_DEMO ? ` Hid ${hidden} demo songs.` : ''}`);
      if (quotaHit) console.log('Note: your daily quota ran out during the search, so some genres may have fewer songs. Run again tomorrow to add more.');
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

// MOODTIDE_NO_RUN lets tests import the helper functions without starting the import
if (!process.env.MOODTIDE_NO_RUN) main();
