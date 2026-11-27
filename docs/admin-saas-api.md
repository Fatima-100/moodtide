# Admin endpoints for the SaaS dashboard (A27)

All of these are under `/api/admin`, behind requireAuth and requireAdmin: no login gives **401**, a normal user gives **403**.
Lists with `limit` (1 to 200, default 50) and `offset` return `{ total, limit, offset, <items> }`.

## GET /api/admin/users?q=&limit=&offset=
Every user, newest first. `q` searches username and email (a `%` or `_` in `q` is a plain character).
```json
{ "total": 12, "limit": 50, "offset": 0, "users": [
  { "user_id": "usr_...", "username": "Ali", "email": "ali@example.com", "role": "user", "experiment_group": "A",
    "tz": "Asia/Karachi", "created_at": "...", "last_login": "...",
    "plan_id": "plan_free", "plan": "Free", "subscription_status": "active", "plan_ends_at": null } ] }
```
`plan` is the plan in force right now (a Premium that ended, or no subscription at all, shows Free). No password data is returned.

## GET /api/admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&user_id=
Uses per day and metric, newest day first. Default window: the last 14 days; at most 366 days. `user_id` is optional.
```json
[ { "day": "2026-11-27", "metric": "skips", "total": 41, "users": 6 } ]
```
`total` is the sum of the counters, `users` the number of users who used that metric that day. Metrics: refreshes, skips, journeys, playlists.

## GET /api/admin/subscriptions?status=&plan_id=&user_id=&limit=&offset=
`status` is `any` (default), `active`, `cancelled` or `expired`.
Each row has `subscription_id, user_id, username, email, plan_id, plan, status, started_at, ends_at` and
`in_force` (true when the subscription gives the user its plan right now).

## PUT /api/admin/users/:id/plan
Body `{ "plan_id": "plan_premium" }`. An admin grant: **no invoice and no card**. The plan in force ends now (kept as history).
Free has no end date; a paid plan runs 30 days. The change is written to the audit log with the admin as the user.
Answer: `{ changed, plan_id, ends_at, subscription_id }`. `changed: false` means the user was already on that plan.
**400** plan_id missing, **404** unknown user or plan.

## GET /api/admin/metrics
```json
{ "users_total": 12, "active_users_7d": 5, "premium_users": 2, "revenue_month_mock": 998 }
```
- `active_users_7d`: users who logged in or played something in the last 7 days.
- `premium_users`: users whose paid subscription is in force right now (a cancelled one counts until it ends).
- `revenue_month_mock`: paid invoices since the start of this month (server time), in mock rupees.
