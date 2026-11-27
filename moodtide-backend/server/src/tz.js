// User time zones (task A19). The server clock is NOT the user's clock: a user in Lahore at 8 in the morning
// and a user in Los Angeles at 8 in the morning are 13 hours apart, so "time of day" must be computed per user.
import { query } from './db.js';
import { HttpError } from './util.js';

export const DEFAULT_TZ = 'Asia/Karachi';

// PostgreSQL's own list of zone names, read once: lower case -> canonical spelling
let zoneByLower = null;
async function zones(tx) {
  if (!zoneByLower) {
    const rows = await query('SELECT name FROM pg_timezone_names', {}, tx);
    zoneByLower = new Map(rows.map((r) => [r.name.toLowerCase(), r.name]));
  }
  return zoneByLower;
}

/** The canonical name for a time zone, or null if it is not a known name. Never throws on bad input. */
export async function tryNormalizeTimeZone(tz, tx = null) {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return null;
  return (await zones(tx)).get(tz.trim().toLowerCase()) ?? null;
}

/**
 * Check a time zone name and return its canonical spelling: 'asia/karachi' -> 'Asia/Karachi'. Throws a 400 otherwise.
 * Abbreviations like 'PST' and strings like 'UTC+5' are refused: they are ambiguous, and the browser always
 * gives full names (Intl.DateTimeFormat().resolvedOptions().timeZone).
 */
export async function normalizeTimeZone(tz, tx = null) {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) throw new HttpError(400, 'tz must be a time zone name such as "Asia/Karachi"');
  const name = await tryNormalizeTimeZone(tz, tx);
  if (!name) throw new HttpError(400, `tz "${tz}" is not a known time zone name. Use a name like "Asia/Karachi" or "America/New_York"`);
  return name;
}

/** morning 05-11, afternoon 12-16, evening 17-21, night 22-04 (the same cut-offs detectMood always used) */
export function timeOfDayForHour(h) {
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night';
}

/**
 * The hour (0-23) on the wall clock in `tz`. Pass `at` (an ISO time) to ask about a fixed moment, for tests;
 * without it the current time is used.
 */
export async function localHour(tz, at = null, tx = null) {
  const [row] = await query(
    `SELECT EXTRACT(HOUR FROM (COALESCE(@at::timestamptz, now()) AT TIME ZONE @tz))::int AS h`,
    { tz: tz || DEFAULT_TZ, at }, tx);
  return Number(row.h);
}

/** The hour on one USER's clock (users.tz). Returns { tz, hour }. */
export async function userLocalHour(userId, at = null, tx = null) {
  const [row] = await query(
    `SELECT u.tz, EXTRACT(HOUR FROM (COALESCE(@at::timestamptz, now()) AT TIME ZONE u.tz))::int AS hour
     FROM users u WHERE u.user_id = @u`, { u: userId, at }, tx);
  if (row) return { tz: row.tz, hour: Number(row.hour) };
  return { tz: DEFAULT_TZ, hour: await localHour(DEFAULT_TZ, at, tx) };
}
