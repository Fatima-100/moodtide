// Creators (task A32). Tables are in db/init/13_creators.sql.
//   POST /api/creator/register   become a creator
//   GET  /api/creator/consent    the licence choices and the consent text to show before an upload
//   POST /api/creator/uploads    request an upload (saved as 'pending')
//   GET  /api/creator/uploads    my uploads and their status
import { Router } from 'express';
import { query, withTx } from './db.js';
import { HttpError, audit, newId, wrap } from './util.js';
import { validateBody, creatorRegisterSchema, uploadRequestSchema, LICENSES, AUDIO_TYPES } from './schemas.js';
import { createSignedUpload } from './storage.js';

// Stored with every upload, so we can always show what the creator agreed to. Change the wording here.
export const CONSENT_TEXT = 'I made this recording or hold all the rights needed to share it, including the music, '
  + 'lyrics and performance. I allow MoodTide to store and stream it under the licence I selected.';

const UPLOAD_COLS = `up.upload_id, up.title, up.genre_id, g.name AS genre, up.license, up.consent_text, up.consent_at,
  up.status, up.rejection_reason, up.file_key, up.created_at`;

async function requireCreator(userId) {
  const [creator] = await query('SELECT creator_id FROM creators WHERE user_id = @u', { u: userId });
  if (!creator) throw new HttpError(403, 'Register as a creator first (POST /api/creator/register)');
  return creator;
}

export const creatorRouter = Router();

creatorRouter.post('/register', validateBody(creatorRegisterSchema), wrap(async (req, res) => {
  const { display_name, bio } = req.body;
  const creator = await withTx(async (tx) => {
    const [row] = await query(
      `INSERT INTO creators (creator_id, user_id, display_name, bio) VALUES (@id, @u, @n, @b)
       ON CONFLICT (user_id) DO NOTHING RETURNING creator_id, display_name, bio, created_at`,
      { id: newId('crt'), u: req.user.id, n: display_name, b: bio }, tx);
    if (!row) throw new HttpError(409, 'You are already registered as a creator');
    await audit(tx, req.user.id, 'Creators', row.creator_id, 'INSERT', null, { display_name });
    return row;
  });
  res.status(201).json({ creator });
}));

creatorRouter.get('/consent', (_req, res) => res.json({ consent_text: CONSENT_TEXT, licenses: LICENSES }));

creatorRouter.post('/uploads', validateBody(uploadRequestSchema), wrap(async (req, res) => {
  const { creator_id } = await requireCreator(req.user.id);
  const { title, genre_id, license, content_type } = req.body;
  const [genre] = await query('SELECT genre_id FROM genres WHERE genre_id = @g', { g: genre_id });
  if (!genre) throw new HttpError(400, 'genre_id: unknown genre. Use an id from GET /api/genres');

  const id = newId('upl');
  const fileKey = `creator/${creator_id}/${id}.${AUDIO_TYPES[content_type]}`; // never built from user text
  const out = await withTx(async (tx) => {
    await query(
      `INSERT INTO uploads (upload_id, creator_id, title, genre_id, license, consent_text, consent_at, file_key)
       VALUES (@id, @c, @t, @g, @l, @x, now(), @k)`,
      { id, c: creator_id, t: title, g: genre_id, l: license, x: CONSENT_TEXT, k: fileKey }, tx);
    await audit(tx, req.user.id, 'Uploads', id, 'INSERT', null, { title, genre_id, license });
    const [upload] = await query(
      `SELECT ${UPLOAD_COLS} FROM uploads up JOIN genres g ON g.genre_id = up.genre_id WHERE up.upload_id = @id`, { id }, tx);
    return upload;
  });
  res.status(201).json({ upload: out, signed_upload: await createSignedUpload(fileKey, content_type) });
}));

creatorRouter.get('/uploads', wrap(async (req, res) => {
  const { creator_id } = await requireCreator(req.user.id);
  res.json(await query(
    `SELECT ${UPLOAD_COLS} FROM uploads up JOIN genres g ON g.genre_id = up.genre_id
     WHERE up.creator_id = @c ORDER BY up.created_at DESC, up.upload_id`, { c: creator_id }));
}));
