# Rate Limiting & Request Validation (A30) — for Frontend (Person B)

To protect the MoodTide API in production, rate limiting and request body validation have been implemented using `express-rate-limit` and `zod`.

---

## 1. Rate Limiting Rules

| Scope | Limit | Window | HTTP Status Code on Breach | Error Code & Message |
|---|---|---|---|---|
| **Auth (`/api/auth/login`, `/api/auth/register`)** | **10 attempts** per IP | 15 minutes | `429 Too Many Requests` | `{ "error": "Too many authentication attempts from this IP, please try again after 15 minutes.", "code": "RATE_LIMIT_EXCEEDED" }` |
| **Global (`/api/*`)** | **300 requests** per IP | 15 minutes | `429 Too Many Requests` | `{ "error": "Too many requests from this IP, please try again after 15 minutes.", "code": "RATE_LIMIT_EXCEEDED" }` |

Standard rate limit response headers are returned on all calls:
- `RateLimit-Limit`: Maximum requests allowed in current window.
- `RateLimit-Remaining`: Number of requests remaining in current window.
- `RateLimit-Reset`: Seconds remaining until quota resets.

---

## 2. Request Body Validation (`zod`)

Malformed bodies return `HTTP 400 Bad Request` with a clean error message and field-specific breakdown:

```json
{
  "error": "email: Invalid email address",
  "details": [
    {
      "field": "email",
      "message": "Invalid email address"
    }
  ]
}
```

### Validated Endpoints:

- `POST /api/auth/register`: `username` (1-50 chars), `email` (valid format), `password` (min 8 chars).
- `POST /api/auth/login`: `email` (valid format), `password` (required).
- `PUT /api/preferences`: either `region` (one of allowed regions) or `tz` (valid timezone).
- `POST /api/checkins`: `mood` (`happy`, `calm`, `sad`, `energetic`, `stressed`), `energy` (int 1-5).
- `POST /api/mood/correct`: `mood` (one of 5 valid moods).
- `POST /api/plays`: `songId` (required), optional `signal` (`play`, `skip`, `complete`, `replay`, `add_to_playlist`).
- `POST /api/ratings`: `songId` (required), `stars` (integer 1-5).
- `POST /api/playlists`: `name` (1-100 chars), `description` (max 500 chars).
- `POST /api/playlists/:id/songs`: `songId` (required).
- `POST /api/reports`: `songId` (required), `reason` (`cannot_play`, `wrong_info`, `copyright`, `inappropriate`, `duplicate`, `other`), `note` (max 1000 chars).
- `POST /api/feedback`: `text` (required, max 4000 chars), `rating` (optional int 1-5), `page` (optional max 100 chars).
- `POST /api/billing/checkout`: `plan_id`, `card_number`, `expiry`, `cvc`.
