/* A33: object storage, signed upload URLs, upload completion, and signed read URLs.
   Uses an in-memory storage adapter so tests run without live Cloudflare R2 credentials.
   Location: moodtide-backend/server/test/storage.test.js */
import { describe, test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';
import { setStorageAdapter, MAX_UPLOAD_BYTES } from '../src/storage.js';

const stamp = `${Date.now()}.${Math.floor(Math.random() * 1000)}`;
const emails = [];
const songIds = [];
const artistIds = [];
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const good = { title: 'R2 Track', genre_id: 'gen_1', license: 'CC BY', consent: true, content_type: 'audio/mpeg' };

const bucket = new Map();

function installMockStorage() {
  setStorageAdapter({
    async createSignedUpload(fileKey, contentType) {
      return {
        url: `https://r2.example.test/signed-put/${fileKey}`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expires_in: 600,
        max_bytes: MAX_UPLOAD_BYTES,
      };
    },
    async headObject(fileKey) {
      const obj = bucket.get(fileKey);
      return obj ? { exists: true, size: obj.size, contentType: obj.contentType } : { exists: false };
    },
    async deleteObject(fileKey) {
      bucket.delete(fileKey);
    },
    async createSignedRead(fileKey, expiresIn) {
      return `https://r2.example.test/signed-get/${fileKey}?exp=${expiresIn}`;
    },
  });
}

async function newCreator(name) {
  const email = `a33.${name}.${stamp}@example.com`;
  emails.push(email);
  const reg = await request(app).post('/api/auth/register').send({ username: `A33 ${name}`, email, password: 'a33-test-password' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const token = reg.body.token;
  const crt = await request(app).post('/api/creator/register').set(auth(token)).send({ display_name: `Artist ${name}` });
  assert.equal(crt.status, 201, JSON.stringify(crt.body));
  return { token, userId: reg.body.user.user_id, creatorId: crt.body.creator.creator_id };
}

beforeEach(() => {
  bucket.clear();
  installMockStorage();
});

after(async () => {
  setStorageAdapter(null);
  for (const id of songIds) await query('DELETE FROM songs WHERE song_id = @id', { id });
  for (const id of artistIds) await query('DELETE FROM artists WHERE artist_id = @id', { id });
  for (const e of emails) await query('DELETE FROM users WHERE email = @e', { e });
  await closePool();
});

describe('A33 object storage and signed uploads', () => {
  test('requesting an upload returns a 10-min signed PUT URL and rejects files over 15 MB', async () => {
    const c = await newCreator('req');
    const over = await request(app).post('/api/creator/uploads').set(auth(c.token))
      .send({ ...good, size_bytes: MAX_UPLOAD_BYTES + 1 });
    assert.equal(over.status, 400);

    const res = await request(app).post('/api/creator/uploads').set(auth(c.token))
      .send({ ...good, size_bytes: 2_500_000 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.upload.status, 'uploading');
    assert.equal(res.body.signed_upload.method, 'PUT');
    assert.equal(res.body.signed_upload.expires_in, 600);
    assert.equal(res.body.signed_upload.max_bytes, MAX_UPLOAD_BYTES);
    assert.match(res.body.signed_upload.url, /^https:\/\/r2\.example\.test\/signed-put\/creator\//);
  });

  test('complete verifies object exists, enforces 15 MB and audio type, and sets status to pending', async () => {
    const c = await newCreator('complete');
    const other = await newCreator('other');

    const reqRes = await request(app).post('/api/creator/uploads').set(auth(c.token)).send(good);
    const { upload_id: id, file_key: key } = reqRes.body.upload;

    // Another creator gets 404
    const notMine = await request(app).post(`/api/creator/uploads/${id}/complete`).set(auth(other.token));
    assert.equal(notMine.status, 404);

    // Not uploaded yet -> 400
    const missing = await request(app).post(`/api/creator/uploads/${id}/complete`).set(auth(c.token));
    assert.equal(missing.status, 400);

    // Oversized file -> 400 and object deleted from bucket
    bucket.set(key, { size: MAX_UPLOAD_BYTES + 100, contentType: 'audio/mpeg' });
    const tooBig = await request(app).post(`/api/creator/uploads/${id}/complete`).set(auth(c.token));
    assert.equal(tooBig.status, 400);
    assert.equal(bucket.has(key), false);

    // Wrong content type -> 400 and object deleted from bucket
    bucket.set(key, { size: 1024, contentType: 'video/mp4' });
    const badType = await request(app).post(`/api/creator/uploads/${id}/complete`).set(auth(c.token));
    assert.equal(badType.status, 400);
    assert.equal(bucket.has(key), false);

    // Valid MP3 -> 200 and status becomes pending with measured size_bytes
    bucket.set(key, { size: 3_145_728, contentType: 'audio/mpeg' });
    const ok = await request(app).post(`/api/creator/uploads/${id}/complete`).set(auth(c.token));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.upload.status, 'pending');
    assert.equal(Number(ok.body.upload.size_bytes), 3_145_728);

    // Idempotent second call
    const again = await request(app).post(`/api/creator/uploads/${id}/complete`).set(auth(c.token));
    assert.equal(again.status, 200);
    assert.equal(again.body.upload.status, 'pending');
  });

  test('GET /api/songs/:id/stream serves signed read URL only for approved creator tracks', async () => {
    const c = await newCreator('stream');
    const reqRes = await request(app).post('/api/creator/uploads').set(auth(c.token)).send(good);
    const { upload_id: uploadId, file_key: fileKey } = reqRes.body.upload;

    const artistId = `art_a33_${stamp}`;
    const songId = `sng_a33_${stamp}`;
    artistIds.push(artistId);
    songIds.push(songId);
    await query('INSERT INTO artists (artist_id, name, source) VALUES (@id, @n, @s)', { id: artistId, n: 'A33 Artist', s: 'creator' });
    await query(
      `INSERT INTO songs (song_id, title, artist_id, duration_sec, source, audio_url, is_active)
       VALUES (@id, 'A33 Song', @a, 180, 'creator', @url, true)`,
      { id: songId, a: artistId, url: fileKey });

    // Upload is still 'uploading' (not approved) -> 404
    const unapproved = await request(app).get(`/api/songs/${songId}/stream`);
    assert.equal(unapproved.status, 404);

    // Approve the upload -> returns signed read URL
    await query(`UPDATE uploads SET status = 'approved' WHERE upload_id = @id`, { id: uploadId });
    const approved = await request(app).get(`/api/songs/${songId}/stream`);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.match(approved.body.stream_url, new RegExp(`^https://r2\\.example\\.test/signed-get/${fileKey}`));
    assert.equal(approved.body.expires_in, 3600);
  });
});
