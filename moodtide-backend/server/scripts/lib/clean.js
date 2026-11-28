// Task A35: find duplicates and broken songs. Nothing is deleted: a song is only hidden (is_active = false).
import { query } from '../../src/db.js';
import { isoToSec } from './normalize.js';

// Stricter than the importer's dupKey on purpose: the whole title must match, so "Song (Remix)" is kept.
// Only case, punctuation and spacing are ignored. Combining marks stay (they are vowels in Hindi).
const strict = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

/**
 * Groups of active songs with the same artist, title and section. In each group one song is kept:
 * creator uploads first, then the one users have rated, played or saved most, then real before demo,
 * then the most popular. Creator uploads are never hidden.
 */
export async function findDuplicates(tx = null) {
  const rows = await query(
    `SELECT s.song_id, s.title, s.source, s.content_type, s.popularity, ar.name AS artist,
       ((SELECT count(*) FROM ratings r WHERE r.song_id = s.song_id)
        + (SELECT count(*) FROM listening_history h WHERE h.song_id = s.song_id)
        + (SELECT count(*) FROM playlist_songs p WHERE p.song_id = s.song_id))::int AS uses
     FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id
     WHERE s.is_active ORDER BY s.song_id`, {}, tx);
  const groups = new Map();
  for (const r of rows) {
    const title = strict(r.title);
    if (!title) continue;
    const key = `${r.content_type}|${strict(r.artist)}|${title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rank = (a, b) => Number(b.source === 'creator') - Number(a.source === 'creator')
    || b.uses - a.uses
    || Number(a.source === 'demo') - Number(b.source === 'demo')
    || b.popularity - a.popularity
    || a.song_id.localeCompare(b.song_id);
  return [...groups.values()].filter((g) => g.length > 1).map((g) => {
    const [keep, ...rest] = g.sort(rank);
    return { keep, hide: rest.filter((s) => s.source !== 'creator') };
  }).filter((g) => g.hide.length);
}

/** Hide the extra copies. The kept song first receives their genres, so no category loses a track. */
export async function hideDuplicates(groups, tx) {
  for (const g of groups) {
    await query(
      `INSERT INTO song_genres (song_id, genre_id)
       SELECT DISTINCT @keep::text, genre_id FROM song_genres WHERE song_id = ANY(@ids)
       ON CONFLICT DO NOTHING`, { keep: g.keep.song_id, ids: g.hide.map((s) => s.song_id) }, tx);
  }
  return hideSongs(groups.flatMap((g) => g.hide.map((s) => s.song_id)), tx);
}

export async function hideSongs(ids, tx = null) {
  if (!ids.length) return [];
  const rows = await query(`UPDATE songs SET is_active = false WHERE song_id = ANY(@ids) AND is_active RETURNING song_id`, { ids }, tx);
  return rows.map((r) => r.song_id);
}

/** Active songs that cannot be played at all: no video id (YouTube) or no stream address (Jamendo, Audius). */
export function findUnplayable(tx = null) {
  return query(
    `SELECT s.song_id, s.source, s.title, ar.name AS artist,
       CASE WHEN s.source = 'youtube' THEN 'no video id' ELSE 'no stream address' END AS reason
     FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id
     WHERE s.is_active AND ((s.source = 'youtube' AND coalesce(s.external_id, '') = '')
        OR (s.source IN ('jamendo', 'audius') AND coalesce(s.audio_url, '') = ''))
     ORDER BY s.source, s.song_id`, {}, tx);
}

export function activeYouTube(tx = null) {
  return query(
    `SELECT s.song_id, s.source, s.title, ar.name AS artist, s.external_id
     FROM songs s JOIN artists ar ON ar.artist_id = s.artist_id
     WHERE s.is_active AND s.source = 'youtube' AND coalesce(s.external_id, '') <> '' ORDER BY s.song_id`, {}, tx);
}

/** Why a video cannot be played here, or null when it can. `v` is a videos.list item (undefined = gone). */
export function videoProblem(v, region = 'PK') {
  if (!v) return 'video removed or private';
  const st = v.status || {}, rr = v.contentDetails?.regionRestriction;
  if (st.privacyStatus === 'private') return 'private';
  if (st.embeddable === false) return 'embedding not allowed';
  if (rr?.blocked?.includes(region) || (rr?.allowed && !rr.allowed.includes(region))) return `blocked in ${region}`;
  if (v.contentDetails?.duration && isoToSec(v.contentDetails.duration) === 0) return 'live or empty video';
  return null;
}

/**
 * Ask YouTube about every id (50 per request, 1 quota unit each). Any failed request throws, so a
 * network or quota problem can never look like "all these videos are gone".
 */
export async function checkVideos(songs, { key, region = 'PK', base = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3' }) {
  const bad = [];
  for (let i = 0; i < songs.length; i += 50) {
    const batch = songs.slice(i, i + 50);
    const url = new URL(`${base}/videos`);
    url.search = new URLSearchParams({ part: 'status,contentDetails', id: batch.map((s) => s.external_id).join(','), key }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const json = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(json?.items)) throw new Error(`YouTube API ${res.status}: ${json?.error?.message || 'unexpected answer'}`);
    const found = new Map(json.items.map((v) => [v.id, v]));
    for (const s of batch) {
      const reason = videoProblem(found.get(s.external_id), region);
      if (reason) bad.push({ ...s, reason });
    }
  }
  return bad;
}

/** SQL that hides, in another database (Neon), every song hidden here. It never switches a song on. */
export async function hiddenSql(tx = null) {
  const rows = await query(`SELECT song_id FROM songs WHERE NOT is_active ORDER BY song_id`, {}, tx);
  if (!rows.length) return '-- no hidden songs\n';
  const list = rows.map((r) => `'${r.song_id.replaceAll("'", "''")}'`).join(',\n  ');
  return `-- ${rows.length} songs hidden in the local catalog\nUPDATE songs SET is_active = false WHERE is_active AND song_id IN (\n  ${list}\n);\n`;
}
