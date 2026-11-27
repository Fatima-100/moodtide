// Admin moderation endpoints (task A34).
// Mounted by routes.js inside the admin router (already behind requireAuth + requireAdmin).
//   GET  /api/admin/uploads?status=pending   review queue of creator uploads
//   PUT  /api/admin/uploads/:id              approve (creates songs row + attribution) or reject (with reason)
//   PUT  /api/admin/songs/:id/takedown       hide a song (is_active = false) and log why
//   GET  /api/admin/reports?status=open      review queue of reported tracks
//   PUT  /api/admin/reports/:id              mark a report resolved or dismissed
import { Router } from 'express';
import { query, withTx } from './db.js';
import { HttpError, audit, newId, wrap } from './util.js';
import { validateBody, moderateUploadSchema, takedownSongSchema, moderateReportSchema } from './schemas.js';

export const moderation = Router();

const UPLOAD_STATUSES = ['uploading', 'pending', 'approved', 'rejected', 'all'];
const REPORT_STATUSES = ['open', 'resolved', 'dismissed', 'all'];
const DEFAULT_CREATOR_DURATION_SEC = 180; // placeholder until audio analysis (A36) measures exact duration

function pageOf(req) {
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'limit must be 1 to 200');
  if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'offset must be >= 0');
  return { limit, offset };
}

/** GET /api/admin/uploads?status=pending&limit=&offset= */
moderation.get('/uploads', wrap(async (req, res) => {
  const status = String(req.query.status ?? 'pending');
  if (!UPLOAD_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of ${UPLOAD_STATUSES.join(', ')}`);
  }
  const { limit, offset } = pageOf(req);
  const filter = status === 'all' ? null : status;

  const [{ total }] = await query(
    `SELECT count(*)::int AS total FROM uploads WHERE (@s::text IS NULL OR status = @s)`,
    { s: filter });
  const uploads = await query(
    `SELECT up.upload_id, up.creator_id, c.display_name AS creator_name, c.user_id AS creator_user_id,
            up.title, up.genre_id, g.name AS genre, up.license, up.consent_text, up.consent_at,
            up.status, up.rejection_reason, up.file_key, up.content_type, up.size_bytes, up.created_at
     FROM uploads up
     JOIN creators c ON c.creator_id = up.creator_id
     JOIN genres g ON g.genre_id = up.genre_id
     WHERE (@s::text IS NULL OR up.status = @s)
     ORDER BY CASE WHEN up.status = 'pending' THEN 0 ELSE 1 END, up.created_at ASC, up.upload_id
     LIMIT @limit OFFSET @offset`,
    { s: filter, limit, offset });

  res.json({ total, limit, offset, uploads });
}));

/** PUT /api/admin/uploads/:id  { status: 'approved' | 'rejected', reason? } */
moderation.put('/uploads/:id', validateBody(moderateUploadSchema), wrap(async (req, res) => {
  const { status, reason } = req.body;
  const uploadId = req.params.id;

  const result = await withTx(async (tx) => {
    const [up] = await query(
      `SELECT up.*, c.display_name
       FROM uploads up
       JOIN creators c ON c.creator_id = up.creator_id
       WHERE up.upload_id = @id FOR UPDATE`,
      { id: uploadId }, tx);
    if (!up) throw new HttpError(404, 'Upload not found');
    if (up.status !== 'pending') {
      throw new HttpError(409, `Upload is ${up.status} and cannot be moderated`);
    }

    if (status === 'rejected') {
      await query(
        `UPDATE uploads SET status = 'rejected', rejection_reason = @r WHERE upload_id = @id`,
        { id: uploadId, r: reason }, tx);
      await audit(tx, req.user.id, 'Uploads', uploadId, 'UPDATE',
        { status: 'pending' }, { status: 'rejected', rejection_reason: reason });
      const [updated] = await query('SELECT * FROM uploads WHERE upload_id = @id', { id: uploadId }, tx);
      return { upload: updated, song_id: null };
    }

    // Approval: ensure creator has an artist row, create the songs row, link genre, and audit both.
    const [artist] = await query(
      `INSERT INTO artists (artist_id, name, source, external_id)
       VALUES (@aid, @name, 'creator', @cid)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name
       RETURNING artist_id`,
      { aid: newId('art'), name: up.display_name, cid: up.creator_id }, tx);

    const songId = newId('sng');
    const contentType = up.genre_id.startsWith('gen_isl_') ? 'islamic' : 'music';
    const attributionText = `${up.title} by ${up.display_name} (${up.license}) — ${up.consent_text}`;

    await query(
      `INSERT INTO songs (song_id, artist_id, title, duration_sec, audio_url, is_active, source, external_id, content_type, license, attribution_text)
       VALUES (@sid, @aid, @t, @dur, @url, true, 'creator', @eid, @ct, @lic, @attr)`,
      {
        sid: songId,
        aid: artist.artist_id,
        t: up.title,
        dur: DEFAULT_CREATOR_DURATION_SEC,
        url: up.file_key,
        eid: up.upload_id,
        ct: contentType,
        lic: up.license,
        attr: attributionText,
      }, tx);

    await query(
      `INSERT INTO song_genres (song_id, genre_id) VALUES (@sid, @gid) ON CONFLICT DO NOTHING`,
      { sid: songId, gid: up.genre_id }, tx);

    await query(
      `UPDATE uploads SET status = 'approved', rejection_reason = NULL WHERE upload_id = @id`,
      { id: uploadId }, tx);

    await audit(tx, req.user.id, 'Uploads', uploadId, 'UPDATE',
      { status: 'pending' }, { status: 'approved', song_id: songId });
    await audit(tx, req.user.id, 'Songs', songId, 'INSERT',
      null, { source: 'creator', upload_id: uploadId, license: up.license });

    const [updated] = await query('SELECT * FROM uploads WHERE upload_id = @id', { id: uploadId }, tx);
    return { upload: updated, song_id: songId };
  });

  res.json(result);
}));

/** PUT /api/admin/songs/:id/takedown  { reason } */
moderation.put('/songs/:id/takedown', validateBody(takedownSongSchema), wrap(async (req, res) => {
  const { reason } = req.body;
  const songId = req.params.id;

  const out = await withTx(async (tx) => {
    const [song] = await query(
      `SELECT song_id, title, is_active, source FROM songs WHERE song_id = @id FOR UPDATE`,
      { id: songId }, tx);
    if (!song) throw new HttpError(404, 'Song not found');

    if (song.is_active) {
      await query(`UPDATE songs SET is_active = false WHERE song_id = @id`, { id: songId }, tx);
      await audit(tx, req.user.id, 'Songs', songId, 'UPDATE',
        { is_active: true }, { is_active: false, reason });
    }
    return { song_id: songId, is_active: false, reason };
  });

  res.json(out);
}));

/** GET /api/admin/reports?status=open&limit=&offset= */
moderation.get('/reports', wrap(async (req, res) => {
  const status = String(req.query.status ?? 'open');
  if (!REPORT_STATUSES.includes(status)) {
    throw new HttpError(400, `status must be one of ${REPORT_STATUSES.join(', ')}`);
  }
  const { limit, offset } = pageOf(req);
  const filter = status === 'all' ? null : status;

  const [{ total }] = await query(
    `SELECT count(*)::int AS total FROM track_reports WHERE (@s::text IS NULL OR status = @s)`,
    { s: filter });
  const reports = await query(
    `SELECT tr.report_id, tr.song_id, s.title AS song_title, s.source AS song_source, s.is_active AS song_active,
            ar.name AS artist, tr.user_id AS reporter_id, u.username AS reporter_username,
            tr.reason, tr.note, tr.status, tr.created_at
     FROM track_reports tr
     JOIN songs s ON s.song_id = tr.song_id
     JOIN artists ar ON ar.artist_id = s.artist_id
     JOIN users u ON u.user_id = tr.user_id
     WHERE (@s::text IS NULL OR tr.status = @s)
     ORDER BY tr.created_at DESC, tr.report_id
     LIMIT @limit OFFSET @offset`,
    { s: filter, limit, offset });

  res.json({ total, limit, offset, reports });
}));

/** PUT /api/admin/reports/:id  { status: 'resolved' | 'dismissed' } */
moderation.put('/reports/:id', validateBody(moderateReportSchema), wrap(async (req, res) => {
  const { status } = req.body;
  const reportId = req.params.id;

  const updated = await withTx(async (tx) => {
    const [old] = await query('SELECT * FROM track_reports WHERE report_id = @id FOR UPDATE', { id: reportId }, tx);
    if (!old) throw new HttpError(404, 'Report not found');

    const [row] = await query(
      `UPDATE track_reports SET status = @st WHERE report_id = @id RETURNING *`,
      { id: reportId, st: status }, tx);
    await audit(tx, req.user.id, 'Track_Reports', reportId, 'UPDATE',
      { status: old.status }, { status });
    return row;
  });

  res.json({ report: updated });
}));
