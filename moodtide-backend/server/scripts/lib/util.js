// Small helpers used by every importer.
import { createHash } from 'node:crypto';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round3 = (x) => Math.round(x * 1000) / 1000;
export const cut = (s, n) => String(s ?? '').slice(0, n);
export const warn = (m) => console.warn(`  ! ${m}`);

/** Same text always gives the same number between 0 and 1 (so re-runs give the same estimates). */
export const unit = (s) => parseInt(createHash('md5').update(String(s)).digest('hex').slice(0, 8), 16) / 0xffffffff;
export const jitter = (key, amount) => (unit(key) - 0.5) * 2 * amount;
export const md5 = (s) => createHash('md5').update(String(s)).digest('hex');

/** YouTube-style popularity (0-100) from a view count. */
export const popularityFromViews = (views) => clamp(Math.round((Math.log10((Number(views) || 0) + 1) - 3) * 16), 5, 100);
