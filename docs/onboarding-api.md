# Onboarding API (A31) — for the frontend

`POST /api/onboarding` (needs the login token)

```json
{ "languages": ["urdu", "english"], "genres": ["gen_ghazal", "gen_2"], "listening_times": ["evening", "night"] }
```

- `languages`: any of `urdu`, `punjabi`, `english`, `hindi`, `korean`, `japanese`
- `genres`: genre ids from `GET /api/genres` (also accepts Islamic category ids)
- `listening_times`: any of `morning`, `afternoon`, `evening`, `night`
- at least one language or one genre is required; repeated values are counted once

Response `201 { "batch_id": "...", "region": "all", "genres": [...], "taste_rows_seeded": 19 }`. The first batch is then `GET /api/suggestions`.
Invalid input returns `400 { "error": "languages.0: ..." }`.

How the answers are used:
- One language sets the region preference (urdu = pakistani, punjabi = punjabi, english = international, hindi = indian, korean, japanese). Only Hindi/Korean/Japanese chosen together gives `asian`. Any other mix gives `all`.
- Chosen genres start with a high taste score, all other music genres with a neutral one, so the first batch leans to what was chosen.
- Answering again is allowed (a settings screen can reuse it). What the user has really listened to is never overwritten.

`GET /api/onboarding` returns `{ "completed": false }` or `{ "completed": true, "languages": [...], "genres": [...], "listening_times": [...], "completed_at": "..." }`. Use it to decide whether to show the first-run screens.
