# Charts and song credits

## GET /api/charts/pakistan

Public, no login. "Trending on Last.fm in Pakistan" for the Home screen.

Query: `limit` (1 to 50, default 20)

```json
{
  "country": "Pakistan",
  "source": "Last.fm",
  "fetched_at": "2026-11-28T08:00:00.000Z",
  "tracks": [
    { "position": 1, "title": "Example Song", "artist": "Example Artist",
      "lastfm_url": "https://www.last.fm/music/...", "song_id": null }
  ]
}
```

- `song_id` is set when the track is an active song in the catalog; otherwise link to `lastfm_url`.
- No data yet: `fetched_at` is null and `tracks` is `[]`.
- The screen must credit Last.fm and link to it.
- The list is refreshed by `node scripts/enrich-lastfm.mjs --chart-only`.

## Credit fields on songs

Song objects built from the common song query (list, one song, similar, suggestions, playlists) include:

| Field | Meaning |
|---|---|
| `source` | `youtube`, `jamendo`, `audius`, `creator` or `demo` |
| `license` | licence name, or null (YouTube) |
| `attribution_text` | credit line to show in the player, or null |
| `source_url` | page the credit links to, or null |
| `length_class` | `short`, `standard`, `long` or null |

For `creator` songs `audio_url` is a storage key: get the playable link from `GET /api/songs/:id/stream`.
