# Short-Clip Feed API (A29) — for Frontend (Person B)

`GET /api/feed/clips` — serves a swipeable feed of short preview clips (TikTok / Reels style).

Requires user authentication header:
`Authorization: Bearer <jwt_token>`

---

## Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `10` | Number of clips to return (min 1, max 30). |
| `cursor` | string (base64) | `null` | Pagination cursor returned from previous page's `next_cursor`. Excludes songs seen in previous swipes so clips never repeat. |
| `mood` | string | detected | Optional explicit mood override (`happy`, `calm`, `sad`, `energetic`, `stressed`). If omitted, uses the user's recent checkin or detected mood. |

---

## Response `200 OK`

```json
{
  "clips": [
    {
      "song_id": "jam_26737",
      "title": "Breathe",
      "artist": "Sample Artist",
      "artist_id": "jam_ar_10",
      "album": "Atmospheres",
      "cover_url": "https://...",
      "audio_url": "https://prod-1.storage.jamendo.com/...",
      "source": "jamendo",
      "genre": "Ambient & Drone",
      "duration_sec": 214,
      "clip_start_sec": 53,
      "clip_len_sec": 30,
      "target_mood": "sad",
      "is_exploration": false,
      "license": "https://creativecommons.org/licenses/by-nc-sa/3.0/",
      "attribution_text": "Music by ... under CC BY-NC-SA 3.0",
      "source_url": "https://www.jamendo.com/track/26737"
    }
  ],
  "target_mood": "sad",
  "limit": 10,
  "cursor": null,
  "next_cursor": "eyJzZWVuIjpbImphbV8yNjczNyJdLCJvZmZzZXQiOjEwfQ=="
}
```

---

## Audio & Clip Rules

1. **Only audio sources**: Strictly Jamendo, Audius, or approved creator uploads (`source IN ('jamendo', 'audius', 'creator')`). YouTube songs are excluded from this feed because they require an embedded video player rather than direct audio streaming.
2. **Preview window**:
   - `clip_start_sec`: Starts ~25% into the song (or uses manual custom `clip_start_sec`).
   - `clip_len_sec`: Fixed preview duration of 30 seconds (or remaining song length if shorter).
   - The frontend audio player should start playing from `clip_start_sec` and automatically advance/loop after `clip_len_sec`.
3. **Exploration**: 80% matches the target mood, 20% marked `is_exploration: true` introduces varied tracks.
4. **Impression Tracking**:
   - When each clip appears on screen, log an impression batch using `POST /api/events`:
     ```json
     [
       {
         "event_type": "impression",
         "song_id": "jam_26737",
         "context": { "screen": "feed" }
       }
     ]
     ```
   - Future feed calls automatically exclude songs that the user has seen in the last 7 days.
