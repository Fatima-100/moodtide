/**
 * MoodTide engine: the stored-procedure / trigger logic from the old db.ts mock,
 * now running against PostgreSQL. Every function takes `tx` so callers decide the transaction.
 *
 * NOTE: the song queries below use songs.content_type and songs.region, which are
 * part of db/init/01_schema.sql.
 */
import { query } from './db.js';
import { HttpError, audit, clamp, newId } from './util.js';
import { userLocalHour, timeOfDayForHour } from './tz.js';

export const MOOD_COORDINATES = {
  happy:     { energy: 0.75, happiness: 0.85, tempo: 124, label: 'Happy' },
  calm:      { energy: 0.32, happiness: 0.65, tempo: 78,  label: 'Calm' },
  sad:       { energy: 0.28, happiness: 0.22, tempo: 68,  label: 'Sad / Melancholic' },
  energetic: { energy: 0.88, happiness: 0.72, tempo: 138, label: 'Energetic' },
  stressed:  { energy: 0.65, happiness: 0.28, tempo: 110, label: 'Stressed / Frustrated' },
};

// If your Implicit_Signals CHECK constraint uses a different word, change it here only.
const SIGNAL_ADD = 'add_to_playlist';

// How many songs one suggestion batch holds (about 80% familiar, 20% exploration)
const BATCH_SIZE = 20;
const BATCH_FAMILIAR = 16;
const BATCH_EXPLORE = 4;

// "asian" is a group: it covers every Asian region the importer can tag
const REGION_GROUPS = { asian: ['indian', 'korean', 'japanese'] };
const regionList = (r) => REGION_GROUPS[r] ?? [r];

const SONG_GENRE_APPLY = `LEFT JOIN LATERAL (
  SELECT g.genre_id, g.name AS genre_name
  FROM song_genres sg JOIN genres g ON g.genre_id = sg.genre_id
  WHERE sg.song_id = s.song_id ORDER BY g.genre_id LIMIT 1) gx ON true`;

/* ------------------------------------------------------------------ detectMood */
// `now` (an ISO time) is only for tests: it pretends the current moment is that instant.
export async function detectMood(userId, tx, { preferCheckin = true, now = null } = {}) {
  // newest first (the old mock sliced from the wrong end)
  const rows = await query(
    `SELECT h.song_id, h.completed, h.listened_sec, f.energy, f.tempo
     FROM Listening_History h LEFT JOIN Song_Features f ON f.song_id = h.song_id
     WHERE h.user_id = @u ORDER BY h.played_at DESC LIMIT 10`, { u: userId }, tx);

  let skipCount = 0;
  for (const r of rows) {
    if (!r.completed && r.listened_sec < 25) skipCount++; else break;
  }
  const last4 = rows.slice(0, 4).map((r) => r.song_id);
  const replayCount = last4.length - new Set(last4).size > 0 ? 1 : 0;

  const withFeat = rows.slice(0, 5).filter((r) => r.energy != null);
  const avgEnergy = withFeat.length ? Number((withFeat.reduce((a, r) => a + r.energy, 0) / withFeat.length).toFixed(2)) : 0.5;
  const avgTempo = withFeat.length ? Math.round(withFeat.reduce((a, r) => a + r.tempo, 0) / withFeat.length) : 100;

  // The hour on the USER's clock (users.tz, default Asia/Karachi), not the server's (A19).
  const { hour } = await userLocalHour(userId, now, tx);
  const timeOfDay = timeOfDayForHour(hour);

  let mood = 'calm', score = 75, rule = 'Default baseline mood';
  if (skipCount >= 3) { mood = 'stressed'; score = 40; rule = `Skip streak of ${skipCount} songs: restless or frustrated listening.`; }
  else if (replayCount >= 1 && avgEnergy < 0.5) { mood = 'calm'; score = 88; rule = 'Replay loop on a low-energy track: calm, focused headspace.'; }
  else if (avgEnergy > 0.7 && avgTempo > 120) { mood = 'energetic'; score = 85; rule = `High momentum: avg energy ${avgEnergy}, avg tempo ${avgTempo} BPM.`; }
  else if (avgEnergy < 0.35 && avgTempo < 75) { mood = 'sad'; score = 48; rule = `Low energy (${avgEnergy}) and slow tempo (${avgTempo} BPM).`; }
  else if (timeOfDay === 'morning' && avgEnergy > 0.5) { mood = 'happy'; score = 82; rule = 'Morning lift with steady upbeat listening.'; }
  else if (timeOfDay === 'night') { mood = 'calm'; score = 80; rule = 'Late-night settling into quiet hours.'; }

  const [checkin] = await query(
    'SELECT checkin_id, mood_label, energy_level FROM Mood_Checkins WHERE user_id = @u ORDER BY checked_at DESC LIMIT 1',
    { u: userId }, tx);

  // A check-in from the last 6 hours is what the user told us they feel, so it wins over the history rules.
  // (The "Re-check my mood" button passes preferCheckin = false to detect from listening history only.)
  if (preferCheckin) {
    const [recent] = await query(
      `SELECT mood_label, energy_level FROM Mood_Checkins
       WHERE user_id = @u AND checked_at >= now() - interval '6 hours' ORDER BY checked_at DESC LIMIT 1`,
      { u: userId }, tx);
    if (recent) {
      mood = recent.mood_label;
      score = recent.energy_level * 20;
      rule = `You told us you feel ${recent.mood_label} (energy ${recent.energy_level}/5).`;
    }
  }

  const scoreId = newId('msc');
  await query(
    `INSERT INTO Mood_Scores (score_id, user_id, calculated_at, detected_mood, mood_score, skip_count, replay_count,
                              time_of_day, avg_energy, avg_tempo, checkin_id)
     VALUES (@id, @u, now(), @m, @s, @sk, @rp, @t, @ae, @at, @c)`,
    { id: scoreId, u: userId, m: mood, s: score, sk: skipCount, rp: replayCount, t: timeOfDay, ae: avgEnergy, at: avgTempo, c: checkin?.checkin_id ?? null },
    tx);
  await audit(tx, userId, 'Mood_Scores', scoreId, 'INSERT', null, { mood, score });
  return { score_id: scoreId, detected_mood: mood, mood_score: score, rule, time_of_day: timeOfDay, avg_energy: avgEnergy, avg_tempo: avgTempo, latest_checkin: checkin ?? null };
}

/* ------------------------------------------------------------------- mood match */
// A20: for each tagged song, how strongly its tags point to this mood (0 to 1).
// It is the weighted share of the song's mapped tags: unmapped tags (country, instrument...) do not count.
// A song with no mapped tag is not in the result.
export async function tagScores(mood, tx) {
  const rows = await query(
    `SELECT st.song_id, (SUM(st.weight * COALESCE(m.weight, 0)) / SUM(st.weight))::float8 AS tag_score
     FROM song_tags st LEFT JOIN tag_mood_map m ON m.tag = st.tag AND m.mood = @mood
     WHERE st.weight > 0 AND EXISTS (SELECT 1 FROM tag_mood_map k WHERE k.tag = st.tag)
     GROUP BY st.song_id`, { mood }, tx);
  return new Map(rows.map((r) => [r.song_id, r.tag_score]));
}

// Blend of the audio features (distance to the mood's energy and happiness) and the tags.
// A song without a tag score is judged on its features alone, so missing tags are not a penalty.
export function moodMatch(song, target, tagScore, wTag) {
  const dist = Math.hypot(song.energy - target.energy, song.happiness - target.happiness);
  const featureScore = Math.max(0.05, 1 - dist);
  if (tagScore == null) return featureScore;
  return (1 - wTag) * featureScore + wTag * tagScore;
}

/* ------------------------------------------------------------ generateSuggestions */
export async function generateSuggestions(userId, tx) {
  const [user] = await query('SELECT user_id, experiment_group, region_pref FROM Users WHERE user_id = @u', { u: userId }, tx);
  if (!user) throw new HttpError(404, 'User not found');
  // which kind of music the user chose: all / pakistani / punjabi / asian / international ...
  const regionPref = user.region_pref ?? 'all';
  const prefRegions = regionList(regionPref);

  const weightRows = await query('SELECT weight_name, weight_value FROM Scoring_Weights', {}, tx);
  const W = (name, fb) => weightRows.find((w) => w.weight_name === name)?.weight_value ?? fb;
  const w_taste = W('w_taste', 0.35), w_similar = W('w_similar', 0.15), w_fresh = W('w_fresh', 0.10), w_recent = W('w_recent', 0.20);
  const isGroupA = user.experiment_group === 'A';
  const w_mood = isGroupA ? 0 : W('w_mood', 0.30); // A/B: cohort A is taste-only
  const w_tag = clamp(W('w_tag', 0.4), 0, 1);      // share of the mood match that comes from tags (A20)

  const [latest] = await query('SELECT score_id, detected_mood FROM Mood_Scores WHERE user_id = @u ORDER BY calculated_at DESC LIMIT 1', { u: userId }, tx);
  const mood = latest?.detected_mood ?? 'calm';
  const base = MOOD_COORDINATES[mood];
  // if the user just checked in with this mood, the 1-5 energy slider nudges the target energy
  const [ck] = await query(
    `SELECT mood_label, energy_level FROM Mood_Checkins
     WHERE user_id = @u AND checked_at >= now() - interval '6 hours' ORDER BY checked_at DESC LIMIT 1`,
    { u: userId }, tx);
  const target = ck && ck.mood_label === mood
    ? { ...base, energy: clamp(0.7 * base.energy + 0.3 * (ck.energy_level / 5), 0, 1) }
    : base;

  const hist = await query('SELECT song_id FROM Listening_History WHERE user_id = @u ORDER BY played_at DESC', { u: userId }, tx);
  const listened = new Set(hist.map((h) => h.song_id));
  const recent = new Set(hist.slice(0, 15).map((h) => h.song_id));

  const taste = await query('SELECT genre_id, affinity_score FROM User_Taste_Profile WHERE user_id = @u', { u: userId }, tx);
  const affinity = new Map(taste.map((t) => [t.genre_id, t.affinity_score]));
  const topGenres = new Set([...affinity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((a) => a[0]));

  const liked = await query(
    `SELECT DISTINCT r.song_id FROM Ratings r
     WHERE r.stars >= 4 AND r.user_id IN (
       SELECT CASE WHEN user_id_a = @u THEN user_id_b ELSE user_id_a END
       FROM User_Similarity WHERE user_id_a = @u OR user_id_b = @u ORDER BY similarity_score DESC LIMIT 3)`,
    { u: userId }, tx);
  const likedSet = new Set(liked.map((l) => l.song_id));

  // music only: the Islamic section is kept out of mood suggestions
  const songs = await query(
    `SELECT s.song_id, f.energy, s.region, f.happiness, f.tempo, gx.genre_id, gx.genre_name
     FROM Songs s JOIN Song_Features f ON f.song_id = s.song_id ${SONG_GENRE_APPLY}
     WHERE s.is_active = true AND s.content_type = 'music'`, {}, tx);
  const byTags = await tagScores(mood, tx);

  const scored = songs.map((s) => {
    const genreId = s.genre_id ?? 'gen_1';
    const genre = s.genre_name ?? 'Music';
    const taste_s = clamp((affinity.get(genreId) ?? 2.5) / 5, 0.1, 1);
    const mood_s = moodMatch(s, target, byTags.get(s.song_id), w_tag);
    const similar_s = likedSet.has(s.song_id) ? 0.95 : 0.2;
    const fresh_s = listened.has(s.song_id) ? 0.3 : 0.9;
    const penalty = recent.has(s.song_id) ? 0.8 : 0;
    const total = w_taste * taste_s + w_mood * mood_s + w_similar * similar_s + w_fresh * fresh_s - w_recent * penalty;

    const reasons = [];
    if (isGroupA) reasons.push(['taste', `Matches your high affinity for ${genre} (Taste-Only Cohort A)`, 0.7]);
    else {
      if (mood_s > 0.75) reasons.push(['mood', `Harmonizes with your ${target.label} state (${s.tempo} BPM, energy ${s.energy})`, 0.45]);
      if (taste_s > 0.6) reasons.push(['taste', `You frequently enjoy ${genre} tracks`, 0.35]);
    }
    if (similar_s > 0.8) reasons.push(['similar_users', 'Users with similar listening taste rated this 4+ stars', 0.2]);
    if (fresh_s > 0.8) reasons.push(['freshness', 'Fresh discovery outside your recent replay loop', 0.15]);

    return { song_id: s.song_id, total: +total.toFixed(3), taste_s: +taste_s.toFixed(2), mood_s: +mood_s.toFixed(2),
      similar_s: +similar_s.toFixed(2), fresh_s: +fresh_s.toFixed(2), penalty, explore: topGenres.size > 0 && !topGenres.has(genreId), reasons,
      // songs of the kind the user chose always rank ahead; other songs only fill gaps
      in_region: regionPref === 'all' || prefRegions.includes(s.region) };
  });

  const byRegionThenScore = (a, b) => (Number(b.in_region) - Number(a.in_region)) || (b.total - a.total);
  scored.sort(byRegionThenScore);

  // ~20% exploration: familiar songs + a few outside the user's top genres, then fill
  const top = [...scored.filter((s) => !s.explore).slice(0, BATCH_FAMILIAR), ...scored.filter((s) => s.explore).slice(0, BATCH_EXPLORE)];
  for (const s of scored) { if (top.length >= BATCH_SIZE) break; if (!top.includes(s)) top.push(s); }
  top.sort(byRegionThenScore);

  const batchId = newId('bat');
  await query(
    `INSERT INTO Suggestion_Batches (batch_id, user_id, experiment_id, variant, score_id, created_at)
     VALUES (@b, @u, 'exp_1', @v, @s, now())`,
    { b: batchId, u: userId, v: user.experiment_group, s: latest?.score_id ?? null }, tx);

  for (const [i, t] of top.entries()) {
    const sid = newId('sug');
    await query(
      `INSERT INTO Suggestions (suggestion_id, batch_id, song_id, rank_position, total_score, taste_score, mood_match_score,
                                similar_users_score, freshness_score, recent_penalty, is_exploration, outcome)
       VALUES (@id, @b, @song, @rank, @tot, @ta, @mo, @si, @fr, @pe, @ex, 'pending')`,
      { id: sid, b: batchId, song: t.song_id, rank: i + 1, tot: t.total, ta: t.taste_s, mo: t.mood_s, si: t.similar_s, fr: t.fresh_s, pe: t.penalty, ex: t.explore },
      tx);
    for (const [r, [type, text, contrib]] of t.reasons.entries()) {
      await query(
        `INSERT INTO Suggestion_Reasons (reason_id, suggestion_id, reason_type, reason_text, contribution)
         VALUES (@id, @s, @t, @x, @c)`,
        { id: `rsn_${sid}_${r + 1}`, s: sid, t: type, x: text, c: contrib }, tx);
    }
  }
  await audit(tx, userId, 'Suggestion_Batches', batchId, 'INSERT', null, { count: top.length, variant: user.experiment_group, region: regionPref });
  return batchId;
}

/* -------------------------------------------------------------- buildMoodJourney */
export async function buildMoodJourney(userId, fromMood, toMood, tx, region = 'all') {
  const from = MOOD_COORDINATES[fromMood], to = MOOD_COORDINATES[toMood];
  if (!from || !to) throw new HttpError(400, `Mood must be one of: ${Object.keys(MOOD_COORDINATES).join(', ')}`);

  const playlistId = newId('pl');
  await query(
    `INSERT INTO Playlists (playlist_id, user_id, name, description, playlist_type, start_mood, target_mood, created_at)
     VALUES (@id, @u, @n, @d, 'mood_journey', @f, @t, now())`,
    { id: playlistId, u: userId, n: `Mood Journey: ${from.label} → ${to.label}`,
      d: `Harmonic transition from ${from.label} to ${to.label} in 8 steps.`, f: fromMood, t: toMood }, tx);

  // region choice: all / not_pakistani / one region / a group such as asian
  let regionSql = '';
  const regionParams = {};
  if (region === 'not_pakistani') {
    regionSql = "AND s.region <> 'pakistani'";
  } else if (region !== 'all') {
    const list = regionList(region);
    regionSql = `AND s.region IN (${list.map((_, i) => `@r${i}`).join(', ')})`;
    list.forEach((v, i) => { regionParams[`r${i}`] = v; });
  }
  const songs = await query(
    `SELECT s.song_id, f.energy, f.happiness, f.tempo FROM Songs s
     JOIN Song_Features f ON f.song_id = s.song_id
     WHERE s.is_active = true AND s.content_type = 'music' ${regionSql}`,
    regionParams, tx);
  if (!songs.length) throw new HttpError(400, 'No songs for that region yet.');

  const chosen = new Set();
  for (let step = 0; step < 8; step++) {
    const p = step / 7;
    const e = from.energy + (to.energy - from.energy) * p;
    const h = from.happiness + (to.happiness - from.happiness) * p;
    const t = from.tempo + (to.tempo - from.tempo) * p;
    let best = null, bestD = Infinity;
    for (const s of songs) {
      if (chosen.has(s.song_id)) continue;
      const d = Math.sqrt(2 * (s.energy - e) ** 2 + 2 * (s.happiness - h) ** 2 + ((s.tempo - t) / 100) ** 2);
      if (d < bestD) { bestD = d; best = s.song_id; }
    }
    if (!best) break;
    chosen.add(best);
    await query(
      'INSERT INTO Playlist_Songs (playlist_id, song_id, "position", added_at) VALUES (@p, @s, @pos, now())',
      { p: playlistId, s: best, pos: step + 1 }, tx);
  }
  await audit(tx, userId, 'Playlists', playlistId, 'INSERT', null, { fromMood, toMood, steps: chosen.size, region });
  return playlistId;
}

/* ---------------------------------------------------------------- taste + signals */
async function bumpTaste(tx, userId, songId, delta, plays) {
  const [g] = await query('SELECT genre_id FROM song_genres WHERE song_id = @s ORDER BY genre_id LIMIT 1', { s: songId }, tx);
  if (!g) return;
  const [row] = await query('SELECT affinity_score FROM User_Taste_Profile WHERE user_id = @u AND genre_id = @g', { u: userId, g: g.genre_id }, tx);
  if (!row) {
    await query(
      `INSERT INTO User_Taste_Profile (user_id, genre_id, affinity_score, play_count, updated_at)
       VALUES (@u, @g, @a, @p, now())`,
      { u: userId, g: g.genre_id, a: clamp(3 + delta, 1, 5), p: plays }, tx);
  } else {
    await query(
      `UPDATE User_Taste_Profile SET affinity_score = @a, play_count = play_count + @p, updated_at = now()
       WHERE user_id = @u AND genre_id = @g`,
      { u: userId, g: g.genre_id, a: clamp(row.affinity_score + delta, 1, 5), p: plays }, tx);
  }
}

const insertSignal = (tx, userId, songId, suggestionId, type, value) =>
  query(
    `INSERT INTO Implicit_Signals (signal_id, user_id, song_id, suggestion_id, signal_type, signal_value, created_at)
     VALUES (@id, @u, @s, @sg, @t, @v, now())`,
    { id: newId('sig'), u: userId, s: songId, sg: suggestionId, t: type, v: value }, tx);

/** Trigger: onSongPlay */
export async function recordPlay(tx, userId, { songId, listenedSec = 0, completed = false, source = 'search', suggestionId = null, isReplay = false }) {
  const historyId = newId('his');
  await query(
    `INSERT INTO Listening_History (history_id, user_id, song_id, played_at, listened_sec, completed, source, suggestion_id)
     VALUES (@id, @u, @s, now(), @l, @c, @src, @sg)`,
    { id: historyId, u: userId, s: songId, l: Math.round(listenedSec), c: !!completed, src: source, sg: suggestionId }, tx);

  let type = 'full_play', value = 1;
  if (isReplay) { type = 'replay'; value = 2; }
  else if (!completed && listenedSec < 30) { type = 'skip'; value = -1; }
  await insertSignal(tx, userId, songId, suggestionId, type, value);
  await bumpTaste(tx, userId, songId, value * 0.1, 1);

  if (suggestionId)
    await query('UPDATE Suggestions SET outcome = @o WHERE suggestion_id = @id', { o: type === 'skip' ? 'skipped' : 'played', id: suggestionId }, tx);

  // measureSongImpact: mood before vs after, from the two latest check-ins
  const checkins = await query('SELECT mood_label FROM Mood_Checkins WHERE user_id = @u ORDER BY checked_at DESC LIMIT 2', { u: userId }, tx);
  if (checkins.length === 2)
    await query(
      `INSERT INTO Song_Impact (impact_id, user_id, song_id, history_id, mood_before, mood_after, measured_at)
       VALUES (@id, @u, @s, @h, @b, @a, now())`,
      { id: newId('imp'), u: userId, s: songId, h: historyId, b: checkins[1].mood_label, a: checkins[0].mood_label }, tx);

  await audit(tx, userId, 'Listening_History', historyId, 'INSERT', null, { songId, completed, type });
  return { history_id: historyId, signal: type };
}

/** Trigger: onSongRate */
export async function recordRating(tx, userId, songId, stars, suggestionId = null) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, 'stars must be an integer between 1 and 5');
  const ratingId = newId('rat');
  await query(
    'INSERT INTO Ratings (rating_id, user_id, song_id, suggestion_id, stars, rated_at) VALUES (@id, @u, @s, @sg, @st, now())',
    { id: ratingId, u: userId, s: songId, sg: suggestionId, st: stars }, tx);
  await insertSignal(tx, userId, songId, suggestionId, 'full_play', stars - 3);
  await bumpTaste(tx, userId, songId, (stars - 3) * 0.2, 0);
  if (suggestionId) await query("UPDATE Suggestions SET outcome = 'rated' WHERE suggestion_id = @id", { id: suggestionId }, tx);
  await audit(tx, userId, 'Ratings', ratingId, 'INSERT', null, { songId, stars });
  return ratingId;
}

/** Trigger: onPlaylistAdd (the composite primary key rejects duplicates) */
export async function addToPlaylist(tx, userId, playlistId, songId) {
  const [pl] = await query('SELECT user_id FROM Playlists WHERE playlist_id = @p', { p: playlistId }, tx);
  if (!pl || pl.user_id !== userId) throw new HttpError(404, 'Playlist not found');
  if (!songId) throw new HttpError(400, 'songId required');
  const [dup] = await query('SELECT 1 AS x FROM Playlist_Songs WHERE playlist_id = @p AND song_id = @s', { p: playlistId, s: songId }, tx);
  if (dup) throw new HttpError(409, 'Song is already in this playlist');
  const [{ next }] = await query('SELECT COALESCE(MAX("position"), 0) + 1 AS next FROM Playlist_Songs WHERE playlist_id = @p', { p: playlistId }, tx);
  await query(
    'INSERT INTO Playlist_Songs (playlist_id, song_id, "position", added_at) VALUES (@p, @s, @pos, now())',
    { p: playlistId, s: songId, pos: next }, tx);
  await insertSignal(tx, userId, songId, null, SIGNAL_ADD, 2);
  await audit(tx, userId, 'Playlist_Songs', `${playlistId}_${songId}`, 'INSERT', null, { position: next });
  return next;
}

/** Stored procedure: computeUserSimilarity (mean squared rating difference on shared songs) */
export async function computeUserSimilarity(tx) {
  const rows = await query(
    `SELECT a.user_id AS ua, b.user_id AS ub, COUNT(*) AS common, AVG(POWER(CAST(a.stars - b.stars AS FLOAT), 2)) AS mse
     FROM Ratings a JOIN Ratings b ON a.song_id = b.song_id AND a.user_id < b.user_id
     GROUP BY a.user_id, b.user_id`, {}, tx);
  await query('DELETE FROM User_Similarity', {}, tx);
  for (const r of rows)
    await query(
      `INSERT INTO User_Similarity (user_id_a, user_id_b, similarity_score, common_songs, calculated_at)
       VALUES (@a, @b, @s, @c, now())`,
      { a: r.ua, b: r.ub, s: +(1 / (1 + r.mse * 0.25)).toFixed(3), c: r.common }, tx);
  await audit(tx, null, 'User_Similarity', 'BATCH_RECOMPUTE', 'UPDATE', null, { count: rows.length });
  return rows.length;
}