/* =====================================================================
   A6 check: do register, login, me and logout work on PostgreSQL?
   Location: moodtide-backend/server/scripts/auth-check.mjs

   1. Start the API in one window:        npm run dev
   2. In a second window, from the server folder:
        $env:DEMO_ADMIN_PASSWORD = "your-admin-demo-password"   (optional, adds one more check)
        node scripts/auth-check.mjs
   It creates a temporary user and deletes it at the end.
   Prints PASS or FAIL for each check.
   ===================================================================== */
import { query, closePool } from '../src/db.js';

const API = process.env.API_URL || 'http://localhost:4000/api';
const email = `a6.check.${Date.now()}@example.com`;
const password = 'a6-check-password';
const results = [];
let token = null;

async function call(method, path, body, bearer) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
async function check(name, fn) {
  try { results.push(['PASS', name, (await fn()) ?? '']); }
  catch (e) { results.push(['FAIL', name, e.message]); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('register a new user returns 201 and a token', async () => {
  const r = await call('POST', '/auth/register', { username: 'A6 Check', email, password });
  assert(r.status === 201, `status ${r.status}: ${JSON.stringify(r.json)}`);
  assert(r.json?.token, 'no token in the response');
  assert(['A', 'B'].includes(r.json?.user?.experiment_group), 'no cohort A or B');
  token = r.json.token;
  return `cohort ${r.json.user.experiment_group}`;
});

await check('registering the same email again (upper case) returns 409', async () => {
  const r = await call('POST', '/auth/register', { username: 'Copy', email: email.toUpperCase(), password });
  assert(r.status === 409, `expected 409, got ${r.status}: ${JSON.stringify(r.json)}`);
});

await check('register with a short password returns 400', async () => {
  const r = await call('POST', '/auth/register', { username: 'Short', email: `short.${Date.now()}@example.com`, password: '123' });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

await check('login with a wrong password returns 401', async () => {
  const r = await call('POST', '/auth/login', { email, password: 'not-the-password' });
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

await check('login with the right password returns a token (email in any case)', async () => {
  const r = await call('POST', '/auth/login', { email: email.toUpperCase(), password });
  assert(r.status === 200 && r.json?.token, `status ${r.status}: ${JSON.stringify(r.json)}`);
  token = r.json.token;
});

await check('GET /auth/me with the token returns the same email', async () => {
  const r = await call('GET', '/auth/me', null, token);
  assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
  assert(r.json.email === email, `expected ${email}, got ${r.json.email}`);
  assert(r.json.role === 'user', `expected role user, got ${r.json.role}`);
});

await check('GET /auth/me without a token returns 401', async () => {
  const r = await call('GET', '/auth/me');
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

await check('last_login was saved and an audit row was written', async () => {
  const [u] = await query('SELECT last_login FROM users WHERE email = @e', { e: email });
  assert(u && u.last_login instanceof Date, 'last_login is empty');
  const [a] = await query("SELECT count(*) AS c FROM audit_log WHERE table_name = 'Users' AND new_data ->> 'email' = @e", { e: email });
  assert(a.c >= 1, 'no audit row for the registration');
});

await check('logout works and the old token stops working', async () => {
  const out = await call('POST', '/auth/logout', null, token);
  assert(out.status === 200, `logout status ${out.status}`);
  const me = await call('GET', '/auth/me', null, token);
  assert(me.status === 401, `expected 401 after logout, got ${me.status}`);
});

if (process.env.DEMO_ADMIN_PASSWORD) {
  await check('demo admin can log in and has the admin role', async () => {
    const r = await call('POST', '/auth/login', { email: 'admin@moodtide.com', password: process.env.DEMO_ADMIN_PASSWORD });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json.user.role === 'admin', `role is ${r.json.user.role}`);
  });
} else {
  results.push(['SKIP', 'demo admin login', 'set DEMO_ADMIN_PASSWORD to include it']);
}

// clean up the temporary user (sessions are removed by the cascade)
await query('DELETE FROM users WHERE email = @e', { e: email });

console.log('\nA6 auth check');
console.log('-------------');
for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? '   [' + detail + ']' : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL').length;
const passed = results.filter((r) => r[0] === 'PASS').length;
console.log(`\n${passed} passed, ${failed} failed`);
await closePool();
process.exit(failed ? 1 : 0);
