import { Router } from 'express';
import { query, withTx } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import { HttpError, audit, newId, wrap } from './util.js';
import * as engine from './engine.js';
import { parseEvents, insertEvents } from './events.js';
export const api = Router();

const GENRE_APPLY = `LEFT JOIN LATERAL (SELECT g.genre_id, g.name AS genre
  FROM song_genres sg JOIN genres g ON g.genre_id = sg.genre_id WHERE sg.song_id = s.song_id ORDER BY g.genre_id LIMIT 1) gx ON true`;
const SONG_COLS = `s.song_id, s.region, s.content_type, s.title, s.duration_sec, s.release_year, s.audio_url, s.popularity,
  s.external_id, s.external_url,
  ar.artist_id, ar.name AS artist, al.title AS album, al.cover_url, gx.genre_id, gx.genre,
  f.energy, f.happiness, f.tempo, f.danceability, f.acousticness`;
const SONG_FROM = `FROM Songs s JOIN Artists ar ON ar.artist_id = s.artist_id
  LEFT JOIN Albums al ON al.album_id = s.album_id LEFT JOIN Song_Features f ON f.song_id = s.song_id ${GENRE_APPLY}`;

// region values a user can choose ('asian' is a group: indian + korean + japanese)
const REGIONS = ['all', 'pakistani', 'punjabi', 'asian', 'indian', 'korean', 'japanese', 'international'];

/* ---------- catalog (public) ---------- */
// ?type=islamic returns the Islamic categories (Naat, Hamd, ...). Without it, the music genres.
api.get('/genres', wrap(async (req, res) => {
  const islamic = req.query.type === 'islamic';
  res.json(await query(
    `SELECT genre_id, name FROM Genres WHERE ${islamic ? '' : 'NOT'} (LEFT(genre_id, 8) = 'gen_isl_') ORDER BY name`));
}));

api.get('/songs', wrap(async (req, res) => {
  const { q = '', genre = null, region = null, artist = null, year = null, type = 'music',
    sort = 'popular', limit = 50, offset = 0 } = req.query;
  const ORDER = {
    popular: 's.popularity DESC, s.title',
    newest:  'CASE WHEN s.release_year IS NULL THEN 1 ELSE 0 END, s.release_year DESC, s.popularity DESC',
    oldest:  'CASE WHEN s.release_year IS NULL THEN 1 ELSE 0 END, s.release_year ASC, s.popularity DESC',
    title:   's.title ASC',
    artist:  'ar.name ASC, s.title ASC',
  }[sort] ?? 's.popularity DESC, s.title';
  res.json(await query(
    `SELECT ${SONG_COLS} ${SONG_FROM}
     WHERE s.is_active = true
       AND s.content_type = @t
       AND (@q::text = '' OR s.title ILIKE '%' || @q || '%' OR ar.name ILIKE '%' || @q || '%'
            OR al.title ILIKE '%' || @q || '%' OR gx.genre ILIKE '%' || @q || '%')
       AND (@g::text IS NULL OR gx.genre_id = @g)
       AND (@a::text IS NULL OR ar.artist_id = @a)
       AND (@y::int IS NULL OR s.release_year = @y)
       AND (@r::text IS NULL OR s.region = @r OR (@r = 'asian' AND s.region IN ('indian', 'korean', 'japanese')))
     ORDER BY ${ORDER}
     LIMIT @lim OFFSET @off`,
    {
      q: String(q), g: genre, a: artist, y: year ? +year : null,
      t: type === 'islamic' ? 'islamic' : 'music',
      r: region && region !== 'all' ? String(region) : null,
      off: Math.max(0, +offset || 0),
      lim: Math.min(200, Math.max(1, +limit || 50)),
    }));
}));

/** Singers list for the "Browse by singer" view (music only) */
api.get('/artists', wrap(async (_req, res) => res.json(await query(
  `SELECT ar.artist_id, ar.name, COUNT(*) AS song_count, MIN(al.cover_url) AS cover_url
   FROM Artists ar
   JOIN Songs s ON s.artist_id = ar.artist_id AND s.is_active = true AND s.content_type = 'music'
   LEFT JOIN Albums al ON al.album_id = s.album_id
   GROUP BY ar.artist_id, ar.name
   ORDER BY COUNT(*) DESC, ar.name`))));

api.get('/songs/:id', wrap(async (req, res) => {
  const [song] = await query(`SELECT ${SONG_COLS} ${SONG_FROM} WHERE s.song_id = @id`, { id: req.params.id });
  if (!song) throw new HttpError(404, 'Song not found');
  res.json(song);
}));

/* ---------- everything below needs a logged-in user ---------- */
api.use(requireAuth);

api.get('/preferences', wrap(async (req, res) => {
  const [u] = await query('SELECT region_pref FROM Users WHERE user_id = @u', { u: req.user.id });
  res.json({ region: u?.region_pref ?? 'all' });
}));
api.put('/preferences', wrap(async (req, res) => {
  const region = req.body?.region;
  if (!REGIONS.includes(region)) throw new HttpError(400, `region must be one of ${REGIONS.join(', ')}`);
  await withTx(async (tx) => {
    await query('UPDATE Users SET region_pref = @r WHERE user_id = @u', { r: region, u: req.user.id }, tx);
    await audit(tx, req.user.id, 'Users', req.user.id, 'UPDATE', null, { region_pref: region });
  });
  res.json({ region });
}));

api.get('/history', wrap(async (req, res) => res.json(await query(
  `SELECT h.history_id, h.played_at, h.listened_sec, h.completed, h.source, s.song_id, s.title, ar.name AS artist
   FROM Listening_History h JOIN Songs s ON s.song_id = h.song_id JOIN Artists ar ON ar.artist_id = s.artist_id
   WHERE h.user_id = @u ORDER BY h.played_at DESC LIMIT 100`, { u: req.user.id }))));

api.post('/plays', wrap(async (req, res) => {
  if (!req.body?.songId) throw new HttpError(400, 'songId required');
  res.status(201).json(await withTx((tx) => engine.recordPlay(tx, req.user.id, req.body)));
}));

api.post('/ratings', wrap(async (req, res) => {
  const { songId, stars, suggestionId = null } = req.body || {};
  const id = await withTx((tx) => engine.recordRating(tx, req.user.id, songId, Number(stars), suggestionId));
  res.status(201).json({ rating_id: id });
}));

api.get('/ratings', wrap(async (req, res) => res.json(await query(
  'SELECT song_id, stars, rated_at FROM Ratings WHERE user_id = @u ORDER BY rated_at DESC', { u: req.user.id }))));
/* ---------- event log (A18) ---------- */
api.post('/events', wrap(async (req, res) => {
  const events = parseEvents(req.body);
  const accepted = await insertEvents(req.user.id, events);
  res.status(201).json({ accepted });
}));
/* ---------- mood ---------- */
api.get('/mood/current', wrap(async (req, res) => {
  const [row] = await query('SELECT * FROM Mood_Scores WHERE user_id = @u ORDER BY calculated_at DESC LIMIT 1', { u: req.user.id });
  res.json(row ?? null);
}));

/** Detected mood over time: used by the Mood journey chart */
api.get('/mood/history', wrap(async (req, res) => res.json(await query(
  `SELECT score_id, calculated_at, detected_mood, mood_score, skip_count, replay_count, time_of_day, avg_energy, avg_tempo
   FROM Mood_Scores WHERE user_id = @u ORDER BY calculated_at DESC LIMIT 60`, { u: req.user.id }))));

api.post('/mood/detect', wrap(async (req, res) =>
  res.json(await withTx((tx) => engine.detectMood(req.user.id, tx, { preferCheckin: false })))));

api.get('/mood/checkins', wrap(async (req, res) => res.json(await query(
  'SELECT checkin_id, mood_label, energy_level, checked_at FROM Mood_Checkins WHERE user_id = @u ORDER BY checked_at DESC LIMIT 50', { u: req.user.id }))));

/** Manual check-in, then auto-detect mood and refresh suggestions in ONE transaction */
api.post('/checkins', wrap(async (req, res) => {
  const { mood, energy = 3 } = req.body || {};
  if (!engine.MOOD_COORDINATES[mood]) throw new HttpError(400, `mood must be one of ${Object.keys(engine.MOOD_COORDINATES).join(', ')}`);
  if (!Number.isInteger(energy) || energy < 1 || energy > 5) throw new HttpError(400, 'energy must be an integer 1-5');
  const out = await withTx(async (tx) => {
    const id = newId('chk');
    await query(
      'INSERT INTO Mood_Checkins (checkin_id, user_id, mood_label, energy_level, checked_at) VALUES (@id, @u, @m, @e, now())',
      { id, u: req.user.id, m: mood, e: energy }, tx);
    await audit(tx, req.user.id, 'Mood_Checkins', id, 'INSERT', null, { mood, energy });
    const detected = await engine.detectMood(req.user.id, tx);
    const batchId = await engine.generateSuggestions(req.user.id, tx);
    return { checkin_id: id, detected, batch_id: batchId };
  });
  res.status(201).json(out);
}));

/* ---------- suggestions ---------- */
api.get('/suggestions', wrap(async (req, res) => {
  const [batch] = await query('SELECT batch_id, variant, created_at FROM Suggestion_Batches WHERE user_id = @u ORDER BY created_at DESC LIMIT 1', { u: req.user.id });
  if (!batch) return res.json({ batch: null, suggestions: [] });
  const sugs = await query(
    `SELECT sg.suggestion_id, sg.rank_position, sg.total_score, sg.taste_score, sg.mood_match_score, sg.similar_users_score,
            sg.freshness_score, sg.recent_penalty, sg.is_exploration, sg.outcome, ${SONG_COLS}
     FROM Suggestions sg JOIN Songs s ON s.song_id = sg.song_id
     JOIN Artists ar ON ar.artist_id = s.artist_id LEFT JOIN Albums al ON al.album_id = s.album_id
     LEFT JOIN Song_Features f ON f.song_id = s.song_id ${GENRE_APPLY}
     WHERE sg.batch_id = @b ORDER BY sg.rank_position`, { b: batch.batch_id });
  const reasons = await query(
    `SELECT r.suggestion_id, r.reason_type, r.reason_text, r.contribution FROM Suggestion_Reasons r
     JOIN Suggestions sg ON sg.suggestion_id = r.suggestion_id WHERE sg.batch_id = @b`, { b: batch.batch_id });
  res.json({ batch, suggestions: sugs.map((s) => ({ ...s, reasons: reasons.filter((r) => r.suggestion_id === s.suggestion_id) })) });
}));

api.post('/suggestions/generate', wrap(async (req, res) => {
  const batchId = await withTx((tx) => engine.generateSuggestions(req.user.id, tx));
  res.status(201).json({ batch_id: batchId });
}));

/* ---------- playlists ---------- */
api.get('/playlists', wrap(async (req, res) => res.json(await query(
  `SELECT p.*, (SELECT COUNT(*) FROM Playlist_Songs ps WHERE ps.playlist_id = p.playlist_id) AS song_count
   FROM Playlists p WHERE p.user_id = @u ORDER BY p.created_at DESC`, { u: req.user.id }))));

api.post('/playlists', wrap(async (req, res) => {
  const { name, description = '' } = req.body || {};
  if (!name) throw new HttpError(400, 'name required');
  if (String(name).length > 100) throw new HttpError(400, 'name must be 100 characters or fewer');
  const id = newId('pl');
  await withTx(async (tx) => {
    await query(
      `INSERT INTO Playlists (playlist_id, user_id, name, description, playlist_type, start_mood, target_mood, created_at)
       VALUES (@id, @u, @n, @d, 'normal', NULL, NULL, now())`, { id, u: req.user.id, n: name, d: description ?? '' }, tx);
    await audit(tx, req.user.id, 'Playlists', id, 'INSERT', null, { name });
  });
  res.status(201).json({ playlist_id: id });
}));

/** Mood journey: body { from, to, region } where region is optional (all, not_pakistani, or one of REGIONS) */
api.post('/playlists/journey', wrap(async (req, res) => {
  const { from, to, region = 'all' } = req.body || {};
  const allowed = [...REGIONS, 'not_pakistani'];
  if (!allowed.includes(region)) throw new HttpError(400, `region must be one of ${allowed.join(', ')}`);
  const id = await withTx((tx) => engine.buildMoodJourney(req.user.id, from, to, tx, region));
  res.status(201).json({ playlist_id: id });
}));

api.get('/playlists/:id', wrap(async (req, res) => {
  const [pl] = await query('SELECT * FROM Playlists WHERE playlist_id = @p AND user_id = @u', { p: req.params.id, u: req.user.id });
  if (!pl) throw new HttpError(404, 'Playlist not found');
  const songs = await query(
    `SELECT ps."position", ${SONG_COLS} FROM Playlist_Songs ps JOIN Songs s ON s.song_id = ps.song_id
     JOIN Artists ar ON ar.artist_id = s.artist_id LEFT JOIN Albums al ON al.album_id = s.album_id
     LEFT JOIN Song_Features f ON f.song_id = s.song_id ${GENRE_APPLY}
     WHERE ps.playlist_id = @p ORDER BY ps."position"`, { p: req.params.id });
  res.json({ ...pl, songs });
}));

api.post('/playlists/:id/songs', wrap(async (req, res) => {
  const position = await withTx((tx) => engine.addToPlaylist(tx, req.user.id, req.params.id, req.body?.songId));
  res.status(201).json({ position });
}));

api.delete('/playlists/:id/songs/:songId', wrap(async (req, res) => {
  await withTx(async (tx) => {
    const [pl] = await query('SELECT user_id FROM Playlists WHERE playlist_id = @p', { p: req.params.id }, tx);
    if (!pl || pl.user_id !== req.user.id) throw new HttpError(404, 'Playlist not found');
    await query('DELETE FROM Playlist_Songs WHERE playlist_id = @p AND song_id = @s', { p: req.params.id, s: req.params.songId }, tx);
    await audit(tx, req.user.id, 'Playlist_Songs', `${req.params.id}_${req.params.songId}`, 'DELETE');
  });
  res.json({ ok: true });
}));

api.delete('/playlists/:id', wrap(async (req, res) => {
  await withTx(async (tx) => {
    const [pl] = await query('SELECT user_id FROM Playlists WHERE playlist_id = @p', { p: req.params.id }, tx);
    if (!pl || pl.user_id !== req.user.id) throw new HttpError(404, 'Playlist not found');
    await query('DELETE FROM Playlist_Songs WHERE playlist_id = @p', { p: req.params.id }, tx);
    await query('DELETE FROM Playlists WHERE playlist_id = @p', { p: req.params.id }, tx);
    await audit(tx, req.user.id, 'Playlists', req.params.id, 'DELETE');
  });
  res.json({ ok: true });
}));

/* ---------- admin ---------- */
export const admin = Router();
admin.use(requireAdmin);

admin.get('/weights', wrap(async (_req, res) => res.json(await query('SELECT weight_id, weight_name, weight_value, updated_by, updated_at FROM Scoring_Weights'))));

admin.put('/weights', wrap(async (req, res) => {
  const names = ['w_taste', 'w_mood', 'w_similar', 'w_fresh', 'w_recent'];
  await withTx(async (tx) => {
    for (const n of names) {
      const v = req.body?.[n];
      if (v == null) continue;
      if (typeof v !== 'number' || v < 0 || v > 1) throw new HttpError(400, `${n} must be a number between 0 and 1`);
      const [old] = await query('SELECT weight_id, weight_value FROM Scoring_Weights WHERE weight_name = @n', { n }, tx);
      if (!old) continue;
      await query('UPDATE Scoring_Weights SET weight_value = @v, updated_by = @u, updated_at = now() WHERE weight_id = @id',
        { v, u: req.user.id, id: old.weight_id }, tx);
      await audit(tx, req.user.id, 'Scoring_Weights', old.weight_id, 'UPDATE', { [n]: old.weight_value }, { [n]: v });
    }
  });
  res.json({ ok: true });
}));

admin.get('/audit', wrap(async (req, res) => res.json(await query(
  'SELECT * FROM Audit_Log ORDER BY changed_at DESC LIMIT @n', { n: Math.min(500, +req.query.limit || 100) }))));

admin.post('/similarity', wrap(async (_req, res) =>
  res.json({ pairs: await withTx((tx) => engine.computeUserSimilarity(tx)) })));

/** A/B results: completion rate and average rating per cohort */
admin.get('/ab-stats', wrap(async (_req, res) => res.json(await query(
  `SELECT u.experiment_group AS cohort,
          COUNT(DISTINCT u.user_id) AS users,
          COUNT(h.history_id) AS plays,
          CAST(100.0 * SUM(CASE WHEN h.completed THEN 1 ELSE 0 END) / NULLIF(COUNT(h.history_id), 0) AS DECIMAL(5,1)) AS completion_pct,
          (SELECT CAST(AVG(CAST(r.stars AS FLOAT)) AS DECIMAL(3,2)) FROM Ratings r JOIN Users ru ON ru.user_id = r.user_id
            WHERE ru.experiment_group = u.experiment_group) AS avg_stars
   FROM Users u LEFT JOIN Listening_History h ON h.user_id = u.user_id
   GROUP BY u.experiment_group ORDER BY u.experiment_group`))));