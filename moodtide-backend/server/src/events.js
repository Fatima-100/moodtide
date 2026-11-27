// Event log (task A18): validation and the one-statement insert behind POST /api/events.
//
// A request is a JSON array of 1 to 50 events (or { "events": [...], "session_id": "..." }). Each event:
//   event_type     required, one of EVENT_TYPES
//   song_id        required for every type except "checkin"
//   suggestion_id  optional: the suggestion this event came from
//   session_id     optional, up to 64 characters (a random id the app makes once per visit)
//   position       optional integer 0-10000: the rank of the song in the list it was shown in
//   value          optional number: seconds listened, 1/0 for like, energy for a check-in...
//   context        optional object, at most 1000 characters as JSON: screen, source, mood...
//   at             optional ISO time of the event on the device. Used only if it is within the last 7 days
//                  and not more than 5 minutes in the future; otherwise the server time is used.
// camelCase names (eventType, songId, suggestionId, sessionId) are accepted too.
// One bad event rejects the whole request (400), and nothing is saved.
import { query } from './db.js';
import { HttpError } from './util.js';

export const EVENT_TYPES = ['impression', 'play_start', 'play_end', 'skip', 'replay', 'like', 'add_to_playlist', 'share', 'checkin', 'not_my_mood'];
export const MAX_BATCH = 50;
const MAX_CONTEXT_CHARS = 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

const bad = (msg) => { throw new HttpError(400, msg); };
const pick = (e, snake, camel) => e[snake] ?? e[camel];

export function parseEvents(body, now = Date.now()) {
  const list = Array.isArray(body) ? body : body?.events;
  if (!Array.isArray(list)) bad('Send a JSON array of events, or { "events": [ ... ] }');
  if (list.length === 0) bad('The batch is empty');
  if (list.length > MAX_BATCH) bad(`At most ${MAX_BATCH} events per request (got ${list.length})`);
  const defaultSession = Array.isArray(body) ? null : (body.session_id ?? body.sessionId ?? null);

  return list.map((e, i) => {
    const at = `event ${i}`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) bad(`${at}: must be an object`);

    const type = pick(e, 'event_type', 'eventType');
    if (!EVENT_TYPES.includes(type)) bad(`${at}: event_type ${JSON.stringify(type)} is not allowed. Use one of: ${EVENT_TYPES.join(', ')}`);

    const text = (v, name, max) => {
      if (v == null) return null;
      if (typeof v !== 'string' || !v.trim() || v.length > max) bad(`${at}: ${name} must be a non-empty string of at most ${max} characters`);
      return v.trim();
    };
    const songId = text(pick(e, 'song_id', 'songId'), 'song_id', 100);
    if (type !== 'checkin' && !songId) bad(`${at}: song_id is required for ${type}`);
    const suggestionId = text(pick(e, 'suggestion_id', 'suggestionId'), 'suggestion_id', 100);
    const sessionId = text(pick(e, 'session_id', 'sessionId') ?? defaultSession, 'session_id', 64);

    const position = e.position ?? null;
    if (position !== null && !(Number.isInteger(position) && position >= 0 && position <= 10000)) bad(`${at}: position must be an integer from 0 to 10000`);
    const value = e.value ?? null;
    if (value !== null && !(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9)) bad(`${at}: value must be a number`);

    const context = e.context ?? {};
    if (typeof context !== 'object' || Array.isArray(context)) bad(`${at}: context must be an object`);
    const contextJson = JSON.stringify(context);
    if (contextJson.length > MAX_CONTEXT_CHARS) bad(`${at}: context is too large (at most ${MAX_CONTEXT_CHARS} characters as JSON)`);

    // the device time is only trusted when it is plausible
    let when = null;
    if (e.at != null) {
      const t = typeof e.at === 'number' ? e.at : Date.parse(e.at);
      if (Number.isNaN(t)) bad(`${at}: "at" is not a valid time`);
      if (t >= now - WEEK_MS && t <= now + 5 * 60 * 1000) when = new Date(t).toISOString();
    }
    return { session_id: sessionId, event_type: type, song_id: songId, suggestion_id: suggestionId, position, value, context: contextJson, at: when };
  });
}

/** All events in ONE statement. Rows are inserted in the order sent, so event_id follows the array order. */
export async function insertEvents(userId, events, tx = null) {
  const rows = await query(
    `INSERT INTO events (user_id, session_id, event_type, song_id, suggestion_id, "position", "value", context, created_at)
     SELECT @u, t.session_id, t.event_type, t.song_id, t.suggestion_id, t."position", t."value", t.context::jsonb, COALESCE(t.at, now())
     FROM unnest(@sessions::text[], @types::text[], @songs::text[], @sugs::text[], @positions::int[], @values::float8[], @contexts::text[], @ats::timestamptz[])
          WITH ORDINALITY AS t(session_id, event_type, song_id, suggestion_id, "position", "value", context, at, ord)
     ORDER BY t.ord
     RETURNING event_id`,
    {
      u: userId,
      sessions: events.map((e) => e.session_id), types: events.map((e) => e.event_type),
      songs: events.map((e) => e.song_id), sugs: events.map((e) => e.suggestion_id),
      positions: events.map((e) => e.position), values: events.map((e) => e.value),
      contexts: events.map((e) => e.context), ats: events.map((e) => e.at),
    }, tx);
  return rows.length;
}
