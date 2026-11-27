// Plans and subscriptions (task A24). The tables are in db/init/08_plans.sql.
import { query } from './db.js';
import { HttpError, audit, newId } from './util.js';

export const FREE_PLAN_ID = 'plan_free';
export const PREMIUM_PLAN_ID = 'plan_premium';

/**
 * SQL condition for "this subscription row (alias s) is in force right now":
 *  - active and not past its end date, or
 *  - cancelled at period end (A26) but its paid period has not ended yet.
 * Anything else (expired, cancelled and over, no row at all) means the user is on Free.
 */
export const IN_FORCE = `((s.status = 'active' AND (s.ends_at IS NULL OR s.ends_at > now()))
  OR (s.status = 'cancelled' AND s.ends_at IS NOT NULL AND s.ends_at > now()))`;

/**
 * Put a user on the Free plan. Pass the registration's transaction: if anything after this fails,
 * the account AND its subscription are rolled back together, so no user is left without a plan.
 */
export async function startFreeSubscription(tx, userId) {
  const id = newId('sub');
  await query(
    "INSERT INTO subscriptions (subscription_id, user_id, plan_id, status) VALUES (@id, @u, @p, 'active')",
    { id, u: userId, p: FREE_PLAN_ID }, tx);
  await audit(tx, userId, 'Subscriptions', id, 'INSERT', null, { plan: FREE_PLAN_ID });
  return id;
}

/* ---------------------------------------------------------------- A25: limit enforcement */

/** 402 Payment Required. app.js sends err.body as the JSON answer. */
export class LimitError extends HttpError {
  constructor(metric, limit, used) {
    super(402, `Daily limit reached for ${metric} (${limit}). Upgrade to Premium for unlimited use.`);
    this.code = 'LIMIT_REACHED';
    this.body = { error: this.message, code: 'LIMIT_REACHED', metric, limit, used };
  }
}

/**
 * Count one use of `metric` for today and refuse it when the user's plan does not allow more.
 * Call it INSIDE the transaction of the action it guards (pass that tx): when it throws, the transaction
 * rolls back, so the blocked action is not applied AND the counter goes back to the limit (used never
 * climbs above it), and an action that fails for another reason does not use up the user's allowance.
 *
 * "Today" is the user's own calendar day (users.tz, default Asia/Karachi).
 * The plan is the user's subscription in force (see IN_FORCE); none in force counts as Free.
 * A NULL limit means unlimited: the use is still counted (A26 shows today's usage) but never blocked.
 */
export async function checkAndCount(tx, userId, metric) {
  const rows = await query(
    `INSERT INTO usage_counters (user_id, day, metric, count)
     SELECT u.user_id, (now() AT TIME ZONE COALESCE(u.tz, 'Asia/Karachi'))::date, @m, 1
     FROM users u WHERE u.user_id = @u
     ON CONFLICT (user_id, day, metric) DO UPDATE SET count = usage_counters.count + 1
     RETURNING count`,
    { u: userId, m: metric }, tx);
  if (rows.length === 0) throw new HttpError(404, 'User not found');
  const used = rows[0].count;

  const [lim] = await query(
    `SELECT limit_value FROM plan_limits
     WHERE metric = @m AND plan_id = COALESCE(
       (SELECT s.plan_id FROM subscriptions s WHERE s.user_id = @u AND ${IN_FORCE}
        ORDER BY s.started_at DESC LIMIT 1), @free)`,
    { u: userId, m: metric, free: FREE_PLAN_ID }, tx);
  const limit = lim?.limit_value ?? null;
  if (limit !== null && used > limit) throw new LimitError(metric, limit, limit);
  return { used, limit };
}
