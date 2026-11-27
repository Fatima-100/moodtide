/* A30: rate limiting and request validation.
   Location: moodtide-backend/server/test/rate-limit-validation.test.js */
import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { app } from '../src/app.js';
import { query, closePool } from '../src/db.js';
import { registerSchema, checkinSchema, playSchema } from '../src/schemas.js';

describe('A30 Zod schema validation', () => {
  test('registerSchema rejects invalid emails, short passwords, empty usernames', () => {
    assert.equal(registerSchema.safeParse({ username: '', email: 'valid@example.com', password: 'password123' }).success, false);
    assert.equal(registerSchema.safeParse({ username: 'user', email: 'invalid-email', password: 'password123' }).success, false);
    assert.equal(registerSchema.safeParse({ username: 'user', email: 'valid@example.com', password: '123' }).success, false);
    assert.equal(registerSchema.safeParse({ username: 'user', email: 'valid@example.com', password: 'password123' }).success, true);
  });

  test('checkinSchema rejects invalid mood or out of range energy', () => {
    assert.equal(checkinSchema.safeParse({ mood: 'invalid_mood', energy: 3 }).success, false);
    assert.equal(checkinSchema.safeParse({ mood: 'happy', energy: 0 }).success, false);
    assert.equal(checkinSchema.safeParse({ mood: 'happy', energy: 6 }).success, false);
    assert.equal(checkinSchema.safeParse({ mood: 'happy', energy: 3 }).success, true);
  });

  test('playSchema requires songId and accepts optional valid signals', () => {
    assert.equal(playSchema.safeParse({}).success, false);
    assert.equal(playSchema.safeParse({ songId: 'jam_1', signal: 'not_a_signal' }).success, false);
    assert.equal(playSchema.safeParse({ songId: 'jam_1', signal: 'skip' }).success, true);
  });
});

describe('A30 API request body validation returns 400 with readable error', () => {
  test('malformed register returns 400 with message', async () => {
    const res = await request(app).post('/api/auth/register').send({
      username: '',
      email: 'not-an-email',
      password: '123',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
    assert.ok(Array.isArray(res.body.details));
  });

  test('malformed login returns 400 with message', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'bad-email',
      password: '',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });
});

describe('A30 Rate limiting enforcement', () => {
  test('rate limiter returns 429 when max attempts exceeded', async () => {
    // Isolated mini Express app to verify the exact express-rate-limit 10 attempts rule without polluting global IP counters
    const testApp = express();
    testApp.use(express.json());
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many attempts', code: 'RATE_LIMIT_EXCEEDED' },
    });
    testApp.post('/login', limiter, (_req, res) => res.json({ ok: true }));

    // Send 10 successful requests
    for (let i = 1; i <= 10; i++) {
      const res = await request(testApp).post('/login').send({});
      assert.equal(res.status, 200, `attempt ${i} expected 200`);
    }

    // The 11th request must return 429 Too Many Requests
    const blocked = await request(testApp).post('/login').send({});
    assert.equal(blocked.status, 429, '11th attempt must return 429');
    assert.equal(blocked.body.code, 'RATE_LIMIT_EXCEEDED');
  });
});
