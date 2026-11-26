/**
 * MoodTide configuration (task A9).
 * Reads .env, checks it, and refuses to start the server with a clear message
 * if something important is missing or unsafe. Nothing else reads JWT_SECRET.
 */
import 'dotenv/config';

const env = process.env;
const problems = [];

// ---- JWT secret: required, long, and not a placeholder
const WEAK = /change-?me|paste-a|dev-secret|your-secret|example|password/i;
const jwtSecret = env.JWT_SECRET || '';
if (!jwtSecret) {
  problems.push(`JWT_SECRET is missing. Create one with:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  and put it in .env`);
} else if (jwtSecret.length < 32) {
  problems.push(`JWT_SECRET is too short (${jwtSecret.length} characters, at least 32 are needed).`);
} else if (WEAK.test(jwtSecret)) {
  problems.push('JWT_SECRET looks like a placeholder. Replace it with a random value.');
}

// ---- Database: a connection string, or the separate DB_* values
if (!env.DATABASE_URL && !(env.DB_USER && env.DB_PASSWORD)) {
  problems.push('Database settings are missing. Set DATABASE_URL, or DB_USER and DB_PASSWORD (with DB_SERVER, DB_PORT, DB_NAME).');
}

// ---- Which websites may call the API (CORS). Exact addresses, comma separated, no trailing slash.
const isProduction = env.NODE_ENV === 'production';
let clientOrigins = (env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
if (clientOrigins.length === 0) {
  if (isProduction) problems.push('CLIENT_ORIGIN is missing (the address of your website, for example https://moodtide.vercel.app).');
  else clientOrigins = ['http://localhost:5173'];
}
for (const o of clientOrigins) {
  try { if (!/^https?:$/.test(new URL(o).protocol)) throw new Error(); }
  catch { problems.push(`CLIENT_ORIGIN has an invalid address: "${o}" (use for example http://localhost:5173).`); }
}

// ---- Port
const port = Number(env.PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push(`PORT must be a number between 1 and 65535 (got "${env.PORT}").`);

if (problems.length) {
  console.error('\nMoodTide cannot start. Fix these in moodtide-backend/server/.env:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSee .env.example for the full list of settings.\n');
  process.exit(1);
}

export const config = { port, clientOrigins, jwtSecret, isProduction };
