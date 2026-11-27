# Event log API (A18) — for the frontend

`POST /api/events` — needs the login token (`Authorization: Bearer ...`).
Send the events in **batches**, not one request per event: collect them and send every few seconds, when 50 are waiting, and when the page is closed (`navigator.sendBeacon` cannot set the header, so use `fetch(..., { keepalive: true })`).

## Request

A JSON array of 1 to 50 events (or `{ "session_id": "...", "events": [ ... ] }`).

```json
[
  { "event_type": "impression", "song_id": "yt_abc123", "suggestion_id": "sug_77", "session_id": "k3j9x2", "position": 0, "context": { "screen": "home" } },
  { "event_type": "play_start", "song_id": "yt_abc123", "suggestion_id": "sug_77", "session_id": "k3j9x2", "position": 0, "context": { "source": "suggestion" } },
  { "event_type": "play_end",   "song_id": "yt_abc123", "session_id": "k3j9x2", "value": 187.5, "context": { "completed": true } },
  { "event_type": "checkin",    "session_id": "k3j9x2", "value": 2, "context": { "mood": "sad" } }
]
```

Response `201 { "accepted": 4 }`. If any event is invalid the whole request fails with `400 { "error": "event 1: ..." }` and nothing is saved.

| field | rule |
|---|---|
| `event_type` | required: `impression`, `play_start`, `play_end`, `skip`, `replay`, `like`, `add_to_playlist`, `share`, `checkin`, `not_my_mood` |
| `song_id` | required for every type except `checkin` |
| `suggestion_id` | optional: set it when the song came from a suggestion |
| `session_id` | optional, up to 64 characters: make one random id per visit |
| `position` | optional integer 0 to 10000: rank of the song in the list it was shown in (0 is the first) |
| `value` | optional number (see below) |
| `context` | optional object, at most 1000 characters as JSON |
| `at` | optional ISO time on the device. Used only if within the last 7 days and not more than 5 minutes ahead; otherwise server time |

## What to put where (a convention, not enforced)

| event | when | `value` | `context` examples |
|---|---|---|---|
| `impression` | a song is shown in a list | | `screen`, `list` |
| `play_start` | playback starts | | `source`: suggestion, search, playlist |
| `play_end` | playback ends | seconds listened | `completed`: true/false |
| `skip` | the user skips | seconds listened before the skip | |
| `replay` | the same song is played again | | |
| `like` | like or unlike | 1 or 0 | |
| `add_to_playlist` | song added to a playlist | | `playlist_id` |
| `share` | song shared | | `channel` |
| `checkin` | mood check-in | energy 1 to 5 | `mood` |
| `not_my_mood` | written by the server when you call `POST /api/mood/correct` (do not send it as well) | | `mood`, `corrected_mood` |

Keep the same names across screens: the weekly analysis (A22 onwards) reads these fields.
