/* A29: Short-clip feed endpoint (GET /api/feed/clips).
   Location: moodtide-backend/server/src/feed.js */
import { query } from './db.js';
import { clamp, wrap } from './util.js';
import { MOOD_COORDINATES, detectMood } from './engine.js';

export const CLIP_LEN_DEFAULT = 30; // 30 seconds preview clip
export const MAX_FEED_LIMIT = 30;
export const DEFAULT_FEED_LIMIT = 10;
export const EXPLORE_RATIO = 0.2; // 20% exploration

/**
 * Calculates straight line feature distance between a song and target mood.
 * Smaller distance = better mood match.
 */
function featureDistance(feat, target) {
  if (!feat || feat.energy == null || feat.happiness == null) return 1.0;
  const dE = Number(feat.energy) - target.energy;
  const dH = Number(feat.happiness) - target.happiness;
  const dT = (Number(feat.tempo || 100) - target.tempo) / 180;
  return Math.sqrt(dE * dE + dH * dH + dT * dT);
}

/**
 * Decodes base64 JSON cursor. Returns parsed object or null.
 */
export function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  try {
    const raw = Buffer.from(cursorStr, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.seen)) {
      return { seen: parsed.seen, offset: Number(parsed.offset) || 0 };
    }
  } catch {
    // invalid cursor: ignore
  }
  return null;
}

/**
 * Encodes cursor state to base64 string.
 */
export function encodeCursor(seenIds, offset) {
  return Buffer.from(JSON.stringify({ seen: seenIds, offset })).toString('base64');
}

/**
 * Core clip feed generator:
 * - Sources: Jamendo, Audius, approved creator uploads only (valid audio_url, never YouTube).
 * - Excludes recent impressions logged in events (event_type = 'impression') plus cursor seen.
 * - Computes clip_start_sec (s.clip_start_sec or ~25% of duration).
 * - 80% mood match + 20% exploration.
 */
export async function getClipFeed(userId, { limit = DEFAULT_FEED_LIMIT, cursor = null, mood: explicitMood = null } = {}, tx = null) {
  const lim = clamp(parseInt(limit, 10) || DEFAULT_FEED_LIMIT, 1, MAX_FEED_LIMIT);
  const cur = decodeCursor(cursor);
  const cursorSeen = new Set(cur?.seen || []);
  const cursorOffset = cur?.offset || 0;

  // 1. Determine target mood: explicit query param OR detect user's current mood
  let targetMood = explicitMood;
  if (!targetMood || !MOOD_COORDINATES[targetMood]) {
    try {
      const detected = await detectMood(userId, tx);
      targetMood = detected.detected_mood;
    } catch {
      targetMood = 'calm';
    }
  }
  const targetCoords = MOOD_COORDINATES[targetMood] || MOOD_COORDINATES.calm;

  // 2. Fetch recent impression song_ids (last 7 days or last 100 impressions)
  const impressions = await query(
    `SELECT DISTINCT song_id FROM events
     WHERE user_id = @u
       AND event_type = 'impression'
       AND song_id IS NOT NULL
       AND created_at >= now() - interval '7 days'
     ORDER BY song_id
     LIMIT 500`,
    { u: userId },
    tx
  );
  const excludedSongIds = new Set([...impressions.map((r) => r.song_id), ...cursorSeen]);

  // 3. Query all active tracks with playable audio and legitimate source
  const songs = await query(
    `SELECT s.song_id, s.title, s.duration_sec, s.audio_url, s.source, s.clip_start_sec,
            s.license, s.attribution_text, s.source_url, s.content_type, s.region,
            ar.artist_id, ar.name AS artist,
            al.album_id, al.title AS album, al.cover_url,
            g.genre_id, g.name AS genre,
            f.energy, f.happiness, f.tempo, f.danceability
     FROM songs s
     JOIN artists ar ON ar.artist_id = s.artist_id
     LEFT JOIN albums al ON al.album_id = s.album_id
     LEFT JOIN song_features f ON f.song_id = s.song_id
     LEFT JOIN LATERAL (
       SELECT g.genre_id, g.name
       FROM song_genres sg
       JOIN genres g ON g.genre_id = sg.genre_id
       WHERE sg.song_id = s.song_id
       ORDER BY g.genre_id
       LIMIT 1
     ) g ON true
     WHERE s.is_active = true
       AND s.audio_url IS NOT NULL
       AND s.audio_url <> ''
       AND s.source IN ('jamendo', 'audius', 'creator')
     ORDER BY s.song_id`,
    {},
    tx
  );

  // 4. Filter out excluded songs
  const candidatePool = songs.filter((s) => !excludedSongIds.has(s.song_id));

  // If candidate pool exhausted, fall back to entire available songs pool to prevent blank feed
  const activePool = candidatePool.length >= lim ? candidatePool : songs;

  // Score candidate songs for mood match
  const scored = activePool.map((s) => {
    const dist = featureDistance(s, targetCoords);
    // distance is roughly 0 to ~1.7; convert to match score [0, 1]
    const matchScore = Math.max(0, 1 - dist / 1.5);
    return { song: s, matchScore };
  });

  // Sort best mood matches first
  scored.sort((a, b) => b.matchScore - a.matchScore);

  // Separate into 80% familiar / top mood matches and 20% exploration
  const exploreCount = Math.max(1, Math.round(lim * EXPLORE_RATIO));
  const moodCount = lim - exploreCount;

  const topMoodScored = scored.slice(0, Math.min(scored.length, moodCount * 3));
  // Pick random or varied tracks from bottom half or middle for exploration
  const exploreScored = scored.slice(topMoodScored.length);

  const selected = [];
  const selectedIds = new Set();

  // Add mood matches
  for (const item of topMoodScored) {
    if (selected.length >= moodCount) break;
    if (!selectedIds.has(item.song.song_id)) {
      selected.push({ ...item.song, is_exploration: false, mood_score: Number(item.matchScore.toFixed(3)) });
      selectedIds.add(item.song.song_id);
    }
  }

  // Add exploration tracks
  const exploreCandidates = exploreScored.length > 0 ? exploreScored : scored;
  for (const item of exploreCandidates) {
    if (selected.length >= lim) break;
    if (!selectedIds.has(item.song.song_id)) {
      selected.push({ ...item.song, is_exploration: true, mood_score: Number(item.matchScore.toFixed(3)) });
      selectedIds.add(item.song.song_id);
    }
  }

  // 5. Format output clips with clip_start_sec and clip_len_sec
  const clips = selected.map((s) => {
    const duration = s.duration_sec || 180;
    // clip start: manual override or ~25% into track
    const startSec = s.clip_start_sec != null && s.clip_start_sec >= 0
      ? s.clip_start_sec
      : Math.floor(duration * 0.25);

    // clip length: between 30 and 45 sec, capped by remaining song duration
    const maxPossible = Math.max(5, duration - startSec);
    const clipLen = Math.min(CLIP_LEN_DEFAULT, maxPossible);

    return {
      song_id: s.song_id,
      title: s.title,
      artist: s.artist,
      artist_id: s.artist_id,
      album: s.album,
      cover_url: s.cover_url,
      audio_url: s.audio_url,
      source: s.source,
      genre: s.genre,
      duration_sec: duration,
      clip_start_sec: startSec,
      clip_len_sec: clipLen,
      target_mood: targetMood,
      is_exploration: s.is_exploration,
      license: s.license,
      attribution_text: s.attribution_text,
      source_url: s.source_url,
    };
  });

  const nextSeen = Array.from(new Set([...Array.from(cursorSeen), ...clips.map((c) => c.song_id)])).slice(-300);
  const nextCursor = clips.length > 0 ? encodeCursor(nextSeen, cursorOffset + clips.length) : null;

  return {
    clips,
    target_mood: targetMood,
    limit: lim,
    cursor: cursor || null,
    next_cursor: nextCursor,
  };
}
