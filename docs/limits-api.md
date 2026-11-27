# Plan limits (A25)

The server enforces the plan limits. The browser must not count anything itself.

## What is limited (per day, per user)

| Metric | Free | Premium | Counted when |
|---|---|---|---|
| `skips` | 10 | unlimited | `POST /api/plays` and the play is a skip (not completed, under 30 s) |
| `refreshes` | 5 | unlimited | `POST /api/suggestions/generate` |
| `journeys` | 2 | unlimited | `POST /api/playlists/journey` |
| `playlists` | 3 | unlimited | `POST /api/playlists` |

Check-ins, `POST /api/mood/correct` and plays that are not skips are never limited.
"Day" is the user's own calendar day (their time zone), so the counters reset at the user's midnight.

## When the limit is reached

HTTP **402 Payment Required**, and the action is not applied:

```json
{ "error": "Daily limit reached for skips (10). Upgrade to Premium for unlimited use.",
  "code": "LIMIT_REACHED", "metric": "skips", "limit": 10, "used": 10 }
```

Frontend: show an upgrade message when `status === 402 && body.code === 'LIMIT_REACHED'`, using `metric` and `limit`.
`used` equals `limit` (a blocked attempt is not counted).
A user with no active subscription, or whose subscription has ended, is treated as Free.
