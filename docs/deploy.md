# Deploying MoodTide (Release 1)

The backend runs on **Render** (Node web service) and the database on **Neon** (Postgres). Both are in the Singapore region. The frontend is deployed separately by Person B and talks to the backend over HTTPS.

> **Never commit or paste secrets** (the Neon connection string, `JWT_SECRET`, API keys) into the repo, issues, or chat. They live only in Render's environment settings and in your own terminal session.

## 1. Create the Neon database

1. Create a Neon project in the **Singapore** region.
2. In **Connect**, turn **Connection pooling off** and copy the **direct** connection string (the host must not contain `-pooler`). The backend sets `statement_timeout` on connect, which poolers can reject, and the app already pools its own connections.
3. Keep `?sslmode=require` on the string.

## 2. Load the schema and seed

Run every file in `db/init/` in order against Neon (`01_schema.sql` through `08_plans.sql`). Result: 9 files, 37 tables, no errors.

```powershell
$NEON = (Read-Host "Paste the Neon connection string").Trim().Trim("'", '"')
# run each db/init/*.sql in order, for example:
docker exec -i moodtide-db psql "$NEON" -v ON_ERROR_STOP=1 < db\init\01_schema.sql
```

Any new migration (for example `06_mood_corrections.sql`, `08_plans.sql`) must also be run on Neon, or the matching endpoints return 500.

## 3. Copy the music catalog

The SQL files only create empty tables. Copy the imported songs from the local Docker database:

```powershell
docker exec moodtide-db sh -c "pg_dump -U moodtide -d moodtide --data-only --column-inserts --on-conflict-do-nothing -t artists -t albums -t songs -t song_features -t song_tags -t song_genres > /tmp/catalog.sql"
docker exec moodtide-db psql "$NEON" -q -v ON_ERROR_STOP=1 -f /tmp/catalog.sql
docker exec moodtide-db psql "$NEON" -c "SELECT (SELECT count(*) FROM songs) AS songs, (SELECT count(*) FROM artists) AS artists;"
```

The counts must match the local database (currently 319 songs, 182 artists).

## 4. Create the Render web service

New, then Web Service, connect the GitHub repo `Fatima-100/moodtide`.

| Setting | Value |
|---|---|
| Region | Singapore |
| Root Directory | `moodtide-backend/server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance type | Free |
| Health Check Path | `/api/health` |

Environment variables:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the direct Neon string |
| `JWT_SECRET` | a new random value: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (never reuse the local one) |
| `CLIENT_ORIGIN` | the exact address of the deployed frontend |

`CLIENT_ORIGIN` is required in production; the server refuses to start without it. It is currently `http://localhost:5173` and **must be changed to Person B's real site address** once the frontend is deployed (no trailing slash), then redeploy.

API keys such as `YOUTUBE_API_KEY` are only used by the importer scripts, not by the running server, so they are not needed on Render.

## 5. Check the deployment

```powershell
Invoke-RestMethod https://moodtide.onrender.com/api/health
```

Expected: `ok: True`, `db: connected`. The free service sleeps when idle, so the first request after a break can take about a minute.

## 6. Remove the demo accounts and create the admin

The seed creates demo users (`usr_admin`, `usr_fatima`, `usr_marcus`). Remove them from the public database:

1. Register your own account through the deployed API or app.
2. Promote it and delete the demo users:

```powershell
$EMAIL = Read-Host "Your account email"
docker exec moodtide-db psql "$NEON" -c "UPDATE users SET role_id = (SELECT role_id FROM roles WHERE role_name='admin') WHERE email = '$EMAIL';"
docker exec moodtide-db psql "$NEON" -c "DELETE FROM users WHERE user_id IN ('usr_admin','usr_fatima','usr_marcus');"
```

`UPDATE 1` means it worked; `UPDATE 0` means the email wasn't found. Confirm with:

```powershell
docker exec moodtide-db psql "$NEON" -c "SELECT u.email, r.role_name FROM users u JOIN roles r USING (role_id);"
```

> `$NEON` does not carry over to a new PowerShell window. If `psql` says `role "root" does not exist`, the variable is empty; set it again.

## 7. Hand-off to Person B

Give Person B the API base URL: `https://moodtide.onrender.com`. They set it as the frontend's API URL, deploy, and send back the frontend address so `CLIENT_ORIGIN` can be updated (step 4).

## 8. Rotating the database password

In the Neon console: Roles, `neondb_owner`, Reset password. Update `DATABASE_URL` in Render, let it redeploy, and recheck `/api/health`.

## Release 1 checklist

Run with Person B on the **public** link, on a phone as well as a desktop. Tick each line.

| # | Step | Expected result | Pass |
|---|---|---|---|
| 1 | `/api/health` | `ok: True`, `db: connected` | [ ] |
| 2 | Register a new user | account created, logged in | [ ] |
| 3 | Log in again with the same account | token returned | [ ] |
| 4 | Check in with a mood | mood detected, suggestions appear | [ ] |
| 5 | Play a track | the stream plays | [ ] |
| 6 | Hit a free-plan limit (for example skip 11 times) | the 11th request returns 402 | [ ] |
| 7 | Upgrade to Premium | the limit no longer applies | [ ] |
| 8 | Log in as admin and open the admin view | users, usage, subscriptions and metrics load | [ ] |
| 9 | Log in as a non-admin on an admin endpoint | 403 | [ ] |
| 10 | Open the public link on a phone | the app loads and steps 2 to 5 work | [ ] |

**Done when** the public link works on a phone and every line passes.
