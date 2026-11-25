import crypto from 'node:crypto';
import { query } from './db.js';

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Append-only audit trail (the "trigger" part of the old mock engine). */
export function audit(tx, userId, table, recordId, action, oldData = null, newData = null) {
  return query(
    `INSERT INTO Audit_Log (log_id, user_id, table_name, record_id, action, old_data, new_data, changed_at)
     VALUES (@id, @u, @t, @r, @a, @o, @n, now())`,
    {
      id: newId('aud'), u: userId, t: table, r: String(recordId), a: action,
      o: oldData ? JSON.stringify(oldData) : null,
      n: newData ? JSON.stringify(newData) : null,
    },
    tx
  );
}
