/* A32: creators and upload requests. Needs the database with db/init loaded (including 13_creators.sql).
   Temporary users are deleted, which also deletes their creator rows and uploads.
   Location: moodtide-backend/server/test/creator.test.js */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';

const stamp = `${Date.now()}.${Math.floor(Math.random() * 1000)}`;
const emails = [];
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const post = (u, path, body) => request(app).post(`/api/creator/${path}`).set(auth(u.token)).send(body);
const list = (u) => request(app).get('/api/creator/uploads').set(auth(u.token));
const good = { title: '  My Song  ', genre_id: 'gen_1', license: 'CC BY', consent: true };

const newUser = async (name) => {
  const email = `a32.${name}.${stamp}@example.com`;
  emails.push(email);
  const res = await request(app).post('/api/auth/register').send({ username: `A32 ${name}`, email, password: 'a32-test-password' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { token: res.body.token, id: res.body.user.user_id };
};

after(async () => {
  for (const e of emails) await query('DELETE FROM users WHERE email = @e', { e });
  await closePool();
});

describe('creator endpoints', () => {
  test('need a login', async () => {
    assert.equal((await request(app).post('/api/creator/register').send({ display_name: 'x' })).status, 401);
    assert.equal((await request(app).get('/api/creator/uploads')).status, 401);
  });

  test('a user who is not a creator gets 403', async () => {
    const u = await newUser('plain');
    assert.equal((await post(u, 'uploads', good)).status, 403);
    assert.equal((await list(u)).status, 403);
  });

  test('register once; a second time is 409; a missing name is 400', async () => {
    const u = await newUser('reg');
    assert.equal((await post(u, 'register', { display_name: '   ' })).status, 400);
    const res = await post(u, 'register', { display_name: ' Test Band ' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.creator.display_name, 'Test Band');
    assert.equal(res.body.creator.bio, '');
    assert.equal((await post(u, 'register', { display_name: 'Again' })).status, 409);
  });

  test('a creator requests an upload and sees its status', async () => {
    const u = await newUser('upload');
    await post(u, 'register', { display_name: 'Uploader' });
    const consent = await request(app).get('/api/creator/consent').set(auth(u.token));
    const res = await post(u, 'uploads', good);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { upload } = res.body;
    assert.equal(upload.title, 'My Song');
    assert.equal(upload.status, 'pending');
    assert.equal(upload.consent_text, consent.body.consent_text);
    assert.ok(upload.consent_at);
    assert.match(upload.file_key, new RegExp(`^creator/crt_\\w+/${upload.upload_id}\\.mp3$`));
    assert.equal(res.body.signed_upload, null);   // storage arrives in A33

    const second = await post(u, 'uploads', { ...good, title: 'Second', content_type: 'audio/aac' });
    assert.match(second.body.upload.file_key, /\.aac$/);

    const mine = await list(u);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.map((x) => x.title), ['Second', 'My Song']);
    assert.ok(mine.body.every((x) => x.status === 'pending' && x.genre));
  });

  test('bad input is refused and nothing is saved', async () => {
    const u = await newUser('bad');
    await post(u, 'register', { display_name: 'Careful' });
    const bad = [
      {}, { ...good, title: '' }, { ...good, genre_id: 'gen_nope' }, { ...good, license: 'mine' },
      { ...good, consent: false }, { ...good, consent: 'true' }, { ...good, content_type: 'video/mp4' },
    ];
    for (const body of bad) assert.equal((await post(u, 'uploads', body)).status, 400, JSON.stringify(body));
    assert.deepEqual((await list(u)).body, []);
  });

  test('creators see only their own uploads, and cannot set the status', async () => {
    const a = await newUser('a');
    const b = await newUser('b');
    await post(a, 'register', { display_name: 'A' });
    await post(b, 'register', { display_name: 'B' });
    const res = await post(a, 'uploads', { ...good, status: 'approved', file_key: 'elsewhere.mp3' });
    assert.equal(res.body.upload.status, 'pending');
    assert.notEqual(res.body.upload.file_key, 'elsewhere.mp3');
    assert.deepEqual((await list(b)).body, []);
  });

  test('the database refuses a rejected upload without a reason', async () => {
    const [row] = await query(
      `SELECT up.upload_id FROM uploads up JOIN creators c ON c.creator_id = up.creator_id
       JOIN users u ON u.user_id = c.user_id WHERE u.email = @e LIMIT 1`, { e: `a32.a.${stamp}@example.com` });
    await assert.rejects(() => query("UPDATE uploads SET status = 'rejected' WHERE upload_id = @id", { id: row.upload_id }),
      (e) => e.code === '23514');
  });
});
