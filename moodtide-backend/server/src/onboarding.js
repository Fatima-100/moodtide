// POST /api/onboarding and GET /api/onboarding (task A31): make the first suggestions personal.
//
//   POST { languages: ["urdu", ...], genres: ["gen_ghazal", ...], listening_times: ["evening", ...] }
//
// In ONE transaction it: saves the answers, sets the region preference from the languages, seeds the taste
// profile (affinity 4 for the chosen genres, 2.5 for every other music genre) and generates the first batch.
// Taste rows the user already earned by listening (play_count > 0) are never overwritten, so answering
// again later cannot wipe real history.
import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from './db.js';
import { HttpError, audit, wrap } from './util.js';
import * as engine from './engine.js';
import { LANGUAGES, LISTENING_TIMES, AFFINITY_CHOSEN, AFFINITY_OTHER, regionFromLanguages } from './onboarding-rules.js';

const unique = (a) => [...new Set(a)];
const bodySchema = z.object({
  languages: z.array(z.enum(LANGUAGES)).max(LANGUAGES.length).default([]).transform(unique),
  genres: z.array(z.string().trim().min(1).max(100)).max(30).default([]).transform(unique),
  listening_times: z.array(z.enum(LISTENING_TIMES)).max(LISTENING_TIMES.length).default([]).transform(unique),
}).refine((v) => v.languages.length + v.genres.length > 0, { message: 'choose at least one language or one genre' });

export const onboardingRouter = Router();

onboardingRouter.get('/', wrap(async (req, res) => {
  const [row] = await query('SELECT languages, genres, listening_times, completed_at FROM user_onboarding WHERE user_id = @u', { u: req.user.id });
  res.json(row ? { completed: true, ...row } : { completed: false });
}));

onboardingRouter.post('/', wrap(async (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  const { languages, genres, listening_times } = parsed.data;

  // every chosen genre must exist (the app should take them from GET /api/genres)
  if (genres.length) {
    const found = new Set((await query('SELECT genre_id FROM genres WHERE genre_id = ANY(@ids)', { ids: genres })).map((g) => g.genre_id));
    const unknown = genres.filter((g) => !found.has(g));
    if (unknown.length) throw new HttpError(400, `genres: unknown genre id ${unknown.join(', ')}. Use the ids from GET /api/genres`);
  }
  const region = regionFromLanguages(languages);

  const out = await withTx(async (tx) => {
    await query(
      `INSERT INTO user_onboarding (user_id, languages, genres, listening_times, completed_at, updated_at)
       VALUES (@u, @l, @g, @t, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET languages = EXCLUDED.languages, genres = EXCLUDED.genres,
                                           listening_times = EXCLUDED.listening_times, updated_at = now()`,
      { u: req.user.id, l: languages, g: genres, t: listening_times }, tx);

    if (region) await query('UPDATE Users SET region_pref = @r WHERE user_id = @u', { r: region, u: req.user.id }, tx);

    // the taste profile: 4 for the chosen genres, 2.5 for every other music genre.
    // Rows with plays (play_count > 0) hold real listening history and are left as they are.
    const seeded = await query(
      `INSERT INTO user_taste_profile (user_id, genre_id, affinity_score, play_count, updated_at)
       SELECT @u::text, g.genre_id, CASE WHEN g.genre_id = ANY(@chosen) THEN @hi::numeric ELSE @lo::numeric END, 0, now()
       FROM genres g
       WHERE left(g.genre_id, 8) <> 'gen_isl_' OR g.genre_id = ANY(@chosen)
       ON CONFLICT (user_id, genre_id) DO UPDATE SET affinity_score = EXCLUDED.affinity_score, updated_at = now()
       WHERE user_taste_profile.play_count = 0
       RETURNING genre_id`,
      { u: req.user.id, chosen: genres, hi: AFFINITY_CHOSEN, lo: AFFINITY_OTHER }, tx);

    await audit(tx, req.user.id, 'Users', req.user.id, 'UPDATE', null, { onboarding: { languages, genres, listening_times, region } });

    // the first batch: it does not count as a "refresh" (it calls the engine directly, not POST /suggestions/generate)
    const batchId = await engine.generateSuggestions(req.user.id, tx);
    const [u] = await query('SELECT region_pref FROM Users WHERE user_id = @u', { u: req.user.id }, tx);
    return { batch_id: batchId, region: u.region_pref, genres, taste_rows_seeded: seeded.length };
  });
  res.status(201).json(out);
}));
