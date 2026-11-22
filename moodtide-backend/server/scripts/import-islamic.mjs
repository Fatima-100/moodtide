#!/usr/bin/env node
// =====================================================================
// MoodTide: import Islamic content (naat, hamd, qasida, darood, kalam, manqabat, nasheed,
// devotional qawwali) from YouTube into the Islamic section.
//
// Put this file in:  moodtide-backend/server/scripts/import-islamic.mjs
// Run it from:       moodtide-backend/server
// First run islamic-setup.sql in SSMS (adds the content_type column and the categories).
//
//   node scripts/import-islamic.mjs --dry-run         (search + match, saves nothing)
//   node scripts/import-islamic.mjs                   (save)
//   node scripts/import-islamic.mjs --only naat       (one category: naat hamd qasida darood kalam manqabat nasheed qawwali)
//   node scripts/import-islamic.mjs --per-query 20 --no-artists
//
// .env needs: DB_SERVER DB_PORT DB_NAME DB_USER DB_PASSWORD YOUTUBE_API_KEY
//
// QUOTA: one YouTube search = 100 units (free limit 10,000/day). The plan is printed first.
// Search results are cached for 7 days (same cache file as import-catalog.mjs).
// Videos play through the official YouTube embedded player. No audio is downloaded.
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
const PER_QUERY = Math.max(1, parseInt(opt('per-query', '15'), 10) || 15);
const DRY_RUN = has('dry-run');
const NO_ARTISTS = has('no-artists');
const ONLY = String(opt('only', '')).toLowerCase();
const FRESH = has('fresh');
const YT_REGION = String(opt('region', 'PK')).toUpperCase();
const YT_KEY = opt('key', process.env.YOUTUBE_API_KEY || process.env.YT_API_KEY || '');
const MIN_SEC = 60, MAX_SEC = 1200; // darood and qasida are often longer than songs

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
  return (await req.query(text)).recordset ?? [];
}

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
// remixes and loops of religious content are skipped on purpose
const BAD_VIDEO = /\b(karaoke|reactions?|reacts?|remix|dj|slowed|reverb|sped up|lofi|lo-fi|8d|nightcore|status|shorts|whatsapp|trailer|teaser|interview|full album|jukebox|compilation|top \d+|best of|\d+ hours?)\b/i;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round3 = (x) => Math.round(x * 1000) / 1000;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
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
const NOISE = /\s*[\(\[\{][^\)\]\}]*(official|video|audio|lyric|visuali[sz]er|\bhd\b|4k|\bmv\b|full|new|latest|\d{4})[^\)\]\}]*[\)\]\}]/gi;
const cleanTitle = (s) => decode(s).replace(NOISE, '').split(/\s[|｜]\s/)[0].replace(/\s{2,}/g, ' ').trim();
const cleanChannel = (c) => decode(c).replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').trim() || 'Unknown';
const classify = (text, fallback) => CLASSIFY_ORDER.find((k) => CATS[k].re.test(text)) || fallback;

// ---------- YouTube ----------
const YT = 'https://www.googleapis.com/youtube/v3';
let units = 0, quotaHit = false;
async function yt(path, params, cost) {
  const url = new URL(YT + path);
  for (const [k, v] of Object.entries({ ...params, key: YT_KEY })) url.searchParams.set(k, String(v));
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
const CACHE_FILE = new URL('./.yt-search-cache.json', import.meta.url);
let searchCache = {};
try { searchCache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* none yet */ }
async function searchVideos(q) {
  const key = `islamic:${q}`;
  const hit = searchCache[key];
  if (!FRESH && hit && Date.now() - hit.t < 7 * 86400000) return hit.list;
  const j = await yt('/search', { part: 'snippet', q, type: 'video', videoEmbeddable: 'true', maxResults: 50 }, 100);
  const list = (j.items || []).filter((i) => i.id?.videoId)
    .map((i) => ({ id: i.id.videoId, title: decode(i.snippet.title), channel: decode(i.snippet.channelTitle) }));
  searchCache[key] = { t: Date.now(), list };
  try { writeFileSync(CACHE_FILE, JSON.stringify(searchCache)); } catch { /* optional */ }
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

// neutral, quiet features (the Islamic section is not used by mood matching, but the table needs numbers)
const featuresFor = (id) => {
  const u = (s) => parseInt(createHash('md5').update(id + s).digest('hex').slice(0, 8), 16) / 0xffffffff - 0.5;
  return {
    energy: round3(clamp(0.25 + u('e') * 0.1, 0, 1)), happiness: round3(clamp(0.5 + u('h') * 0.1, 0, 1)),
    tempo: Math.round(clamp(80 + u('t') * 20, 40, 220)), danceability: round3(clamp(0.15 + u('d') * 0.1, 0, 1)),
    acousticness: round3(clamp(0.8 + u('a') * 0.1, 0, 1)),
  };
};

// ---------- main ----------
async function main() {
  if (!YT_KEY) { console.error('No YouTube key. Put YOUTUBE_API_KEY in .env.'); process.exit(1); }
  if (!process.env.DB_USER || !process.env.DB_PASSWORD) { console.error('DB_USER / DB_PASSWORD missing. Run this from moodtide-backend/server.'); process.exit(1); }

  let items = QUERIES.map(([q, cat]) => ({ q, cat, artist: null, region: 'international' }));
  if (!NO_ARTISTS) items = items.concat(ARTISTS.map(([name, region]) => ({ q: `${name} naat`, cat: 'naat', artist: name, region })));
  if (ONLY) {
    if (!CATS[ONLY]) { console.error(`--only must be one of: ${Object.keys(CATS).join(', ')}`); process.exit(1); }
    items = items.filter((i) => i.cat === ONLY);
  }

  const pool = await new sql.ConnectionPool(config).connect();
  try {
    // ----- preflight -----
    const col = await run(pool, `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Songs' AND COLUMN_NAME = 'content_type'`);
    if (!col.length) { console.error('Songs.content_type does not exist yet. Run islamic-setup.sql in SSMS first.'); process.exit(1); }
    const sg = await run(pool, `SELECT name FROM sys.tables WHERE name IN ('song_genres','song_genre')`);
    if (!sg.length) throw new Error('Could not find a song_genres or song_genre table.');
    const SG = sg[0].name;
    const have = await run(pool, `SELECT genre_id FROM dbo.Genres WHERE genre_id LIKE 'gen[_]isl[_]%'`);
    if (have.length < Object.keys(CATS).length) { console.error('The Islamic categories are missing. Run islamic-setup.sql in SSMS first.'); process.exit(1); }

    console.log(`${items.length} searches, about ${items.length * 100} YouTube units (cached searches cost nothing).${DRY_RUN ? '  (dry run: nothing is saved)' : ''}\n`);

    // ----- 1) search -----
    const found = []; // { item, list }
    for (const item of items) {
      if (quotaHit) { warn('YouTube quota is used up, stopping early'); break; }
      try { found.push({ item, list: await searchVideos(item.q) }); }
      catch (e) { warn(`search "${item.q}": ${e.message}`); }
    }
    const allIds = [...new Set(found.flatMap((f) => f.list.map((v) => v.id)))];
    console.log(`Checking ${allIds.length} videos (length, embeddable, region)...`);
    const details = await fetchDetails(allIds);

    // ----- 2) pick -----
    const catalog = new Map(); // videoId -> record
    const seenKey = new Set();
    for (const { item, list } of found) {
      let kept = 0;
      for (const v of list) {
        if (kept >= PER_QUERY) break;
        const d = details.get(v.id);
        if (!d || !usable(d) || catalog.has(v.id)) continue;
        const text = `${v.title} ${v.channel}`;
        if (BAD_VIDEO.test(v.title) || !RELIGIOUS.test(text)) continue;
        if (item.artist && !norm(text).includes(norm(item.artist))) continue;
        const title = cleanTitle(v.title);
        const artist = item.artist || cleanChannel(v.channel);
        if (!title || title.length < 2) continue;
        const key = `${norm(artist)}|${norm(title)}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        const views = Number(d.statistics?.viewCount) || 0;
        const year = parseInt(String(d.snippet.publishedAt || '').slice(0, 4), 10);
        catalog.set(v.id, {
          id: v.id, title, artist, region: item.region, cat: classify(text, item.cat),
          sec: isoToSec(d.contentDetails.duration), views,
          popularity: clamp(Math.round((Math.log10(views + 1) - 3) * 16), 5, 100),
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
    console.log(`\nIslamic items ready: ${records.length}  by category: ${JSON.stringify(byCat)}   (YouTube units used: about ${units})`);
    if (DRY_RUN) {
      for (const r of records.slice(0, 15)) console.log(`  [${CATS[r.cat].name}] ${r.artist} - ${r.title} (${Math.round(r.sec / 60)} min)`);
      return;
    }
    if (!records.length) { console.error('Nothing found, so nothing was saved.'); process.exitCode = 1; return; }

    // ----- 3) save -----
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      let saved = 0, skipped = 0;
      for (const t of records) {
        const songId = `yt_${t.id}`;
        // a song that is already in the database (for example an earlier music import) is left alone
        const exists = await run(tx, 'SELECT 1 AS x FROM dbo.songs WHERE song_id = @id OR external_id = @ext', { id: songId, ext: t.id });
        if (exists.length) { skipped++; continue; }

        const artistKey = createHash('md5').update(norm(t.artist)).digest('hex').slice(0, 12);
        const artistId = `yta_${artistKey}`;
        await run(tx,
          `UPDATE dbo.artists SET name = @name WHERE artist_id = @id;
           IF @@ROWCOUNT = 0
             INSERT INTO dbo.artists (artist_id, name, country, source, external_id)
             VALUES (@id, @name, NULL, N'youtube', @ext);`,
          { id: artistId, name: [sql.NVarChar(300), cut(t.artist, 300)], ext: artistKey });

        const albumId = `ytb_${t.id}`;
        await run(tx,
          `IF NOT EXISTS (SELECT 1 FROM dbo.albums WHERE album_id = @id)
             INSERT INTO dbo.albums (album_id, artist_id, title, release_year, cover_url, source, external_id)
             VALUES (@id, @artist, @title, @year, @cover, N'youtube', @ext);`,
          { id: albumId, artist: artistId, title: [sql.NVarChar(400), cut(t.title, 400)], year: [sql.Int, t.year],
            cover: [sql.NVarChar(1000), t.thumb], ext: t.id });

        await run(tx,
          `INSERT INTO dbo.songs (song_id, artist_id, album_id, title, duration_sec, release_year, audio_url,
                                  popularity, is_active, source, external_id, external_url, region, content_type)
           VALUES (@id, @artist, @album, @title, @dur, @year, NULL, @pop, 1, N'youtube', @ext, @link, @region, 'islamic')`,
          { id: songId, artist: artistId, album: albumId, title: [sql.NVarChar(500), cut(t.title, 500)],
            dur: [sql.Int, t.sec], year: [sql.Int, t.year], pop: [sql.Int, t.popularity], ext: t.id,
            link: [sql.NVarChar(1000), `https://www.youtube.com/watch?v=${t.id}`], region: [sql.NVarChar(50), t.region] });

        const f = featuresFor(t.id);
        await run(tx,
          `INSERT INTO dbo.song_features (song_id, energy, happiness, tempo, danceability, acousticness, feature_source)
           VALUES (@id, @e, @h, @t, @d, @a, N'estimated')`,
          { id: songId, e: [sql.Float, f.energy], h: [sql.Float, f.happiness], t: [sql.Int, f.tempo],
            d: [sql.Float, f.danceability], a: [sql.Float, f.acousticness] });

        await run(tx, `INSERT INTO dbo.${SG} (song_id, genre_id) VALUES (@s, @g)`, { s: songId, g: CATS[t.cat].id });
        saved++;
      }
      await tx.commit();
      console.log(`\nSaved ${saved} new Islamic items${skipped ? `, skipped ${skipped} that already existed` : ''}.`);
      if (quotaHit) console.log('Note: the YouTube quota ran out, so some searches were skipped. Run again tomorrow.');
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
