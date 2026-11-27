# Mood correction API (A22) — for the frontend

`POST /api/mood/correct` — the "not my mood" button. Needs the login token (`Authorization: Bearer ...`).

## Request

```json
{ "mood": "sad" }
```

`mood` is the mood the user says they are in: `happy`, `calm`, `sad`, `energetic` or `stressed`.

## Response `201`

```json
{
  "correction_id": "cor_1a2b3c4d5e6f",
  "detected": { "detected_mood": "sad", "mood_score": 60, "rule": "You corrected your mood to sad." },
  "batch": { "batch_id": "bat_...", "variant": "B", "created_at": "...", "target_mood": "sad" },
  "suggestions": [ { "suggestion_id": "sug_...", "rank_position": 1, "song_id": "...", "title": "...", "reasons": [] } ]
}
```

(Shortened. `detected` has the same fields as in a check-in, and each suggestion has the same fields as in `GET /api/suggestions`.)

An unknown or missing mood gives `400 { "error": "..." }` and nothing is saved.

## Notes

- Show the returned `suggestions` straight away; no second request is needed.
- The server writes the `not_my_mood` event itself, so do not also send it to `POST /api/events`.
- The corrected mood counts for 6 hours, or until a newer check-in or correction.
- Cohort A users get the new `target_mood`, but their ranking ignores mood by design.
- `GET /api/suggestions` now also includes `batch.target_mood`.
