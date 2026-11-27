# Creator API (A32 & A33) — for the frontend

All creator endpoints need the login token (`Authorization: Bearer ...`). Errors are `{ "error": "..." }`.

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| `POST /api/creator/register` | `display_name` (1-100), `bio` (optional, up to 1000) | `201 { "creator": { creator_id, display_name, bio, created_at } }` | 400, 409 already a creator |
| `GET /api/creator/consent` | | `200 { consent_text, licenses }` | |
| `POST /api/creator/uploads` | see below | `201 { upload, signed_upload }` | 400, 403 not a creator |
| `POST /api/creator/uploads/:id/complete` | | `200 { upload }` (`status: "pending"`) | 400 missing/invalid file, 403, 404, 409 |
| `GET /api/creator/uploads` | | `200 [ upload, ... ]`, newest first | 403 not a creator |
| `GET /api/songs/:id/stream` | | `200 { stream_url, expires_in }` | 404 not found / not approved |

## Request an upload

```json
{
  "title": "My Song",
  "genre_id": "gen_urdu_pop",
  "license": "CC BY",
  "consent": true,
  "content_type": "audio/mpeg",
  "size_bytes": 3145728
}
```

- `genre_id`: from `GET /api/genres`.
- `license`: `CC0`, `CC BY`, `CC BY-SA`, `CC BY-NC` or `CC BY-NC-SA`.
- `consent`: must be `true`. Show the `consent_text` from `GET /api/creator/consent` next to an unticked box.
- `content_type`: `audio/mpeg` (default) or `audio/aac`.
- `size_bytes`: optional integer in bytes, at most 15 MB (`15728640`).

An `upload` has: `upload_id, title, genre_id, genre, license, consent_text, consent_at, status, rejection_reason, file_key, content_type, size_bytes, created_at`.
`status` is `uploading`, `pending`, `approved` or `rejected`.

## Upload flow (A33)

1. Call `POST /api/creator/uploads` to get `{ upload, signed_upload }`.
2. `PUT` the audio file directly to `signed_upload.url` with `signed_upload.headers` (`Content-Type`) within `signed_upload.expires_in` seconds (600s / 10 min).
3. Call `POST /api/creator/uploads/:id/complete`. The server verifies the file exists in Cloudflare R2, checks size (<= 15 MB) and type (`audio/mpeg` or `audio/aac`), and sets `status` to `pending` for admin moderation (A34).
4. Approved creator tracks are streamed via `GET /api/songs/:id/stream`, which returns a short-lived signed read URL (`expires_in: 3600`).
