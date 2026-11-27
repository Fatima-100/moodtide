# Mock billing and plan (A26)

No real money moves. The only cards accepted are the documented test cards. Card data is checked and
thrown away: it is never stored, logged, audited or returned.

All endpoints need a login.

## GET /api/me/plan
```json
{ "plan": { "plan_id": "plan_free", "name": "Free", "price_pkr_mock": 0 },
  "subscription": { "status": "active", "started_at": "...", "ends_at": null, "cancel_at_period_end": false },
  "limits": { "refreshes": 5, "skips": 10, "journeys": 2, "playlists": 3 },
  "usage":  { "refreshes": 1, "skips": 0, "journeys": 0, "playlists": 2 },
  "day": "2026-11-27" }
```
`limits` values are per day; `null` means unlimited (Premium). `usage` is today's count in the user's own time zone.
`subscription` is `null` when the user is on Free without a subscription row (for example after Premium ended).

## POST /api/billing/checkout
Body: `{ "plan_id": "plan_premium", "card_number": "4242 4242 4242 4242", "expiry": "12/45", "cvc": "123" }`

| Card | Result |
|---|---|
| `4242 4242 4242 4242` | **201** `{ invoice, subscription }`. Invoice is `paid` (499 mock PKR), Premium for 30 days |
| `4000 0000 0000 0002` | **402** `{ error, code: "CARD_DECLINED", invoice }`. Invoice is `failed`, the user stays on Free |
| any other card | **400** "This is a demo: use the test card 4242 4242 4242 4242" |

Other errors: **400** bad expiry (must be MM/YY or MM/YYYY and in the future), bad cvc (3 digits), `plan_id` missing or the Free plan;
**404** unknown plan; **409** the user already has that plan running.
Spaces and dashes in the card number are fine.

## POST /api/billing/cancel
Cancels at period end: **200** `{ status: "cancelled", cancel_at_period_end: true, ends_at }`.
The user keeps Premium until `ends_at`, then is on Free. **400** if the user has no paid subscription, **409** if already cancelled.

## GET /api/billing/invoices
`[ { invoice_id, amount_mock, status, created_at } ]`, newest first, only the user's own.
`status` is `paid`, `failed` (declined card), `pending` or `void`.

## Frontend note
- A 402 from checkout with `code: "CARD_DECLINED"` is a declined card; a 402 with `code: "LIMIT_REACHED"` is a plan limit (A25). Check `code`.
- Never put the card number in the console, in analytics or in localStorage.
