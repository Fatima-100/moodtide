# Creator API (A32) — for the frontend

All four endpoints need the login token (`Authorization: Bearer ...`). Errors are `{ "error": "..." }`.

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| `POST /api/creator/register` | `display_name` (1-100), `bio` (optional, up to 1000) | `201 { "creator": { creator_id, display_name, bio, created_at } }` | 400, 409 already a creator |
| `GET /api/creator/consent` | | `200 { consent_text, licenses }` | |
| `POST /api/creator/uploads` | see below | `201 { upload, signed_upload }` | 400, 403 not a creator |
| `GET /api/creator/uploads` | | `200 [ upload, ... ]`, newest first | 403 not a creator |

## Request an upload

```json
{ "title": "My Song", "genre_id": "gen_urdu_pop", "license": "CC BY", "consent": true, "content_type": "audio/mpeg" }
```

- `genre_id`: from `GET /api/genres`.
- `license`: `CC0`, `CC BY`, `CC BY-SA`, `CC BY-NC` or `CC BY-NC-SA`.
- `consent`: must be `true`. Show the `consent_text` from `GET /api/creator/consent` next to an unticked box.
- `content_type`: `audio/mpeg` (default) or `audio/aac`.

An `upload` has: `upload_id, title, genre_id, genre, license, consent_text, consent_at, status, rejection_reason, file_key, created_at`.
`status` is `pending`, `approved` or `rejected`.

**`signed_upload` is `null` for now.** File upload arrives with A33, so do not send audio yet.
