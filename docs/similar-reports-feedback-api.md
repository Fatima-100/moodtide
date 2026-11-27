# Similar songs, reports and feedback API (A23) — for the frontend

Three small endpoints. Paste this file into the shared `api-contract.md`.

| Endpoint | Login needed |
|---|---|
| `GET /api/songs/:id/similar` | no |
| `POST /api/reports` | yes (`Authorization: Bearer ...`) |
| `POST /api/feedback` | yes (`Authorization: Bearer ...`) |

---

## `GET /api/songs/:id/similar` — songs like this one

Optional query: `?limit=` from 1 to 20 (default **10**; anything else falls back to 10).

### Response `200`

An array, best match first. Each item has the **same song fields as `GET /api/songs`** plus four more:

```json
[
  {
    "song_id": "jam_1247372", "title": "Beauty", "artist": "Tryad", "cover_url": "...", "audio_url": "...",
    "energy": 0.323, "happiness": 0.452, "tempo": 88,
    "similarity": 0.7918,
    "distance": 0.1155,
    "shared_tags": ["calm", "peaceful"],
    "same_genre": true
  }
]
```

| field | meaning |
|---|---|
| `similarity` | overall match, 0 to 1 (1 = identical). The list is sorted by this. |
| `distance` | audio distance in (energy, happiness, tempo), 0 to 1 (0 = identical) |
| `shared_tags` | tags both songs have, strongest first, at most 5 (`[]` if none) |
| `same_genre` | `true` if the two songs share a genre |

`similarity` = 0.6 × (1 − distance) + 0.25 × tag match + 0.15 × (1 if same genre). The tag match is the shared tag weight divided by the combined tag weight of both songs.

### Rules

- The song itself is never in the list.
- Only active songs with audio features are listed, and only from the **same section**: a music song gets music, an Islamic song gets Islamic.
- `404 { "error": "Song not found" }` if the id is unknown or the song was taken down.
- A song that has no audio features gives `200 []`.
- This is plain SQL for now. When pgvector replaces it the fields stay the same.

---

## `POST /api/reports` — "report this track"

### Request

```json
{ "songId": "jam_1247372", "reason": "cannot_play", "note": "Stops after 10 seconds" }
```

| field | rule |
|---|---|
| `songId` | required, an existing song (inactive songs can be reported too) |
| `reason` | required: `cannot_play`, `wrong_info`, `copyright`, `inappropriate`, `duplicate`, `other` |
| `note` | optional text, up to 500 characters; **required when `reason` is `other`** |

### Response

`201 { "report_id": "rep_1a2b3c4d5e6f" }` — saved, with status `open`.

`200 { "report_id": "rep_...", "already_reported": true }` — this user already has an open report with the same reason on this song, so nothing new was saved (a double click does not fill the admin queue). Another reason on the same song is a new report.

Errors: `400 { "error": "..." }` for a missing or wrong field (nothing is saved), `404 { "error": "Song not found" }`, `401` without a login.

Show the user a short thank-you either way (`201` or `200`).

---

## `POST /api/feedback` — tester feedback form

### Request

```json
{ "page": "home", "rating": 4, "text": "Suggestions felt right, the skip button is small." }
```

| field | rule |
|---|---|
| `page` | required, where the tester was (for example `home`, `player`, `journey`), up to 100 characters |
| `rating` | required, a whole **number** from 1 to 5 (`"4"` as text is refused) |
| `text` | optional, up to 2000 characters |

### Response

`201 { "feedback_id": "fb_1a2b3c4d5e6f" }`

Errors: `400 { "error": "..." }` (nothing is saved), `401` without a login.

---

## Notes

- Text fields are trimmed; an empty `note` or `text` is saved as nothing (`null`).
- Both POST endpoints write to the audit log. The feedback text is **not** copied there.
- Reports start as `open`. There is no admin screen for them yet; until then read them with:
  `SELECT * FROM track_reports WHERE status = 'open' ORDER BY created_at DESC;`
- Database change: `db/init/07_reports_feedback.sql` creates the tables `track_reports` and `tester_feedback`. Run it once on every existing database, including the hosted one (the command is at the top of that file).
