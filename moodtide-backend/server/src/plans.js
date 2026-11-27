// Plans and subscriptions (task A24). The tables are in db/init/08_plans.sql.
import { query } from './db.js';
import { audit, newId } from './util.js';

export const FREE_PLAN_ID = 'plan_free';

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
