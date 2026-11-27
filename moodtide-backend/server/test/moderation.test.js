/* A34: admin moderation (uploads approve/reject, song takedown, report review queue).
   Location: moodtide-backend/server/test/moderation.test.js */
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
const bucket = new Map();

function installMockStorage() {
  setStorageAdapter({
    async createSignedUpload(fileKey, contentType) {
      return { url: `https://r2.example.test/${fileKey}`, method: 'PUT', headers: { 'Content-Type': contentType }, expires_in: 600, max_bytes: MAX_UPLOAD_BYTES };
    },
    async headObject(fileKey) {
      const obj = bucket.get(fileKey);
      return obj ? { exists: true, size: obj.size, contentType: obj.contentType } : { exists: false };
    },
    async deleteObject(fileKey) { bucket.delete(fileKey); },
    async createSignedRead(fileKey, expiresIn) { return `https://r2.example.test/read/${fileKey}?exp=${expiresIn}`; },
  });
}

async function newAdmin(tag) {
  const u = await newUser(tag);
  await query("UPDATE users SET role_id = (SELECT role_id FROM roles WHERE role_name = 'admin') WHERE user_id = @u", { u: u.id });
  const res = await request(app).post('/api/auth/login').send({ email: `a34.${tag}.${stamp}@example.com`, password: 'a34-test-password' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

async function newUser(name) {
  const email = `a34.${name}.${stamp}@example.com`;
  emails.push(email);
  const res = await request(app).post('/api/auth/register').send({ username: `A34 ${name}`, email, password: 'a34-test-password' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { token: res.body.token, id: res.body.user.user_id };
}

async function createPendingUpload(name, title = 'Pending Track') {
  const u = await newUser(name);
  await request(app).post('/api/creator/register').set(auth(u.token)).send({ display_name: `Creator ${name}` });
  const reqRes = await request(app).post('/api/creator/uploads').set(auth(u.token))
    .send({ title, genre_id: 'gen_1', license: 'CC BY', consent: true, content_type: 'audio/mpeg' });
  assert.equal(reqRes.status, 201, JSON.stringify(reqRes.body));
  const { upload_id: uploadId, file_key: fileKey } = reqRes.body.upload;
  bucket.set(fileKey, { size: 1_500_000, contentType: 'audio/mpeg' });
  const comp = await request(app).post(`/api/creator/uploads/${uploadId}/complete`).set(auth(u.token));
  assert.equal(comp.status, 200, JSON.stringify(comp.body));
  return { user: u, upload: comp.body.upload };
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

describe('A34 moderation endpoints', () => {
  test('requires admin role (401 without login, 403 for normal user)', async () => {
    const u = await newUser('nonadmin');
    assert.equal((await request(app).get('/api/admin/uploads')).status, 401);
    assert.equal((await request(app).get('/api/admin/uploads').set(auth(u.token))).status, 403);
    assert.equal((await request(app).put('/api/admin/uploads/upl_1').set(auth(u.token)).send({ status: 'approved' })).status, 403);
    assert.equal((await request(app).put('/api/admin/songs/sng_1/takedown').set(auth(u.token)).send({ reason: 'test' })).status, 403);
    assert.equal((await request(app).get('/api/admin/reports').set(auth(u.token))).status, 403);
  });

  test('approve creates playable creator song with attribution and audit log; takedown hides it', async () => {
    const adminToken = await newAdmin('admin1');
    const { upload } = await createPendingUpload('approve', `Approved Song ${stamp}`);

    // Appears in pending review queue
    const queue = await request(app).get('/api/admin/uploads?status=pending').set(auth(adminToken));
    assert.equal(queue.status, 200);
    assert.ok(queue.body.uploads.some((x) => x.upload_id === upload.upload_id));

    // Approve upload
    const approveRes = await request(app).put(`/api/admin/uploads/${upload.upload_id}`).set(auth(adminToken))
      .send({ status: 'approved' });
    assert.equal(approveRes.status, 200, JSON.stringify(approveRes.body));
    assert.equal(approveRes.body.upload.status, 'approved');
    const songId = approveRes.body.song_id;
    assert.ok(songId);
    songIds.push(songId);

    // Song row has source='creator', license, and attribution_text with consent text
    const [song] = await query('SELECT * FROM songs WHERE song_id = @id', { id: songId });
    artistIds.push(song.artist_id);
    assert.equal(song.source, 'creator');
    assert.equal(song.license, 'CC BY');
    assert.equal(song.is_active, true);
    assert.ok(song.attribution_text.includes('CC BY'));
    assert.ok(song.attribution_text.includes(upload.consent_text));

    // Stream endpoint serves signed read URL
    const streamRes = await request(app).get(`/api/songs/${songId}/stream`);
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.body.stream_url, new RegExp(`^https://r2\\.example\\.test/read/${upload.file_key}`));

    // Re-moderating returns 409
    const again = await request(app).put(`/api/admin/uploads/${upload.upload_id}`).set(auth(adminToken))
      .send({ status: 'rejected', reason: 'too late' });
    assert.equal(again.status, 409);

    // Takedown hides the song and logs why
    const td = await request(app).put(`/api/admin/songs/${songId}/takedown`).set(auth(adminToken))
      .send({ reason: 'DMCA notice' });
    assert.equal(td.status, 200);
    assert.equal(td.body.is_active, false);

    assert.equal((await request(app).get(`/api/songs/${songId}/stream`)).status, 404);

    // Both approval and takedown are in audit_log
    const logs = await query(
      `SELECT table_name, action, new_data FROM audit_log WHERE record_id IN (@u, @s) ORDER BY changed_at ASC`,
      { u: upload.upload_id, s: songId });
    assert.ok(logs.some((l) => l.table_name === 'Uploads' && l.action === 'UPDATE'));
    assert.ok(logs.some((l) => l.table_name === 'Songs' && l.action === 'INSERT'));
    assert.ok(logs.some((l) => l.table_name === 'Songs' && l.action === 'UPDATE' && l.new_data?.reason === 'DMCA notice'));
  });

  test('reject requires a reason and does not create a song', async () => {
    const adminToken = await newAdmin('admin2');
    const { upload } = await createPendingUpload('reject', `Rejected Song ${stamp}`);

    const noReason = await request(app).put(`/api/admin/uploads/${upload.upload_id}`).set(auth(adminToken))
      .send({ status: 'rejected' });
    assert.equal(noReason.status, 400);

    const rej = await request(app).put(`/api/admin/uploads/${upload.upload_id}`).set(auth(adminToken))
      .send({ status: 'rejected', reason: 'Audio clips heavily' });
    assert.equal(rej.status, 200);
    assert.equal(rej.body.upload.status, 'rejected');
    assert.equal(rej.body.upload.rejection_reason, 'Audio clips heavily');
    assert.equal(rej.body.song_id, null);
  });

  test('reported tracks appear in GET /api/admin/reports and can be resolved', async () => {
    const adminToken = await newAdmin('admin3');
    const { user, upload } = await createPendingUpload('report', `Reported Song ${stamp}`);
    const approveRes = await request(app).put(`/api/admin/uploads/${upload.upload_id}`).set(auth(adminToken))
      .send({ status: 'approved' });
    const songId = approveRes.body.song_id;
    songIds.push(songId);
    const [song] = await query('SELECT artist_id FROM songs WHERE song_id = @id', { id: songId });
    artistIds.push(song.artist_id);

    const rep = await request(app).post('/api/reports').set(auth(user.token))
      .send({ songId, reason: 'copyright', note: 'Sounds like another track' });
    assert.equal(rep.status, 201, JSON.stringify(rep.body));
    const reportId = rep.body.report_id;

    const list = await request(app).get('/api/admin/reports?status=open').set(auth(adminToken));
    assert.equal(list.status, 200);
    const found = list.body.reports.find((r) => r.report_id === reportId);
    assert.ok(found);
    assert.equal(found.song_id, songId);
    assert.equal(found.reason, 'copyright');

    const resolve = await request(app).put(`/api/admin/reports/${reportId}`).set(auth(adminToken))
      .send({ status: 'resolved' });
    assert.equal(resolve.status, 200);
    assert.equal(resolve.body.report.status, 'resolved');
  });
});
