# Moderation API (A34) — for the admin dashboard

All endpoints require an admin login (`Authorization: Bearer ...`). Non-admins receive `403`.

| Endpoint | Query / Body | Success | Errors |
|---|---|---|---|
| `GET /api/admin/uploads` | `?status=pending\|uploading\|approved\|rejected\|all&limit=50&offset=0` | `200 { total, limit, offset, uploads }` | 400, 401, 403 |
| `PUT /api/admin/uploads/:id` | `{ "status": "approved" \| "rejected", "reason"?: "..." }` | `200 { upload, song_id }` | 400, 401, 403, 404, 409 |
| `PUT /api/admin/songs/:id/takedown` | `{ "reason": "..." }` | `200 { song_id, is_active: false, reason }` | 400, 401, 403, 404 |
| `GET /api/admin/reports` | `?status=open\|resolved\|dismissed\|all&limit=50&offset=0` | `200 { total, limit, offset, reports }` | 400, 401, 403 |
| `PUT /api/admin/reports/:id` | `{ "status": "resolved" \| "dismissed" }` | `200 { report }` | 400, 401, 403, 404 |

## Notes
- **Approve**: creates a `songs` row with `source = 'creator'`, `audio_url = file_key`, links `song_genres`, copies `license` and `consent_text` into `attribution_text`, and writes `audit_log` entries for both `Uploads` and `Songs`.
- **Reject**: `reason` is required when `status` is `"rejected"`.
- **Takedown**: sets `songs.is_active = false` and writes an `audit_log` entry with the `reason`. Taken-down songs are excluded from `GET /api/songs` and `GET /api/songs/:id/stream`.
