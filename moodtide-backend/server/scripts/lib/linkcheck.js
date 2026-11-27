// Is a stream URL still alive? (task A17)  Used by catalog-report.mjs.
//
// A HEAD request is tried first. Some servers refuse HEAD, so when it does not look good a GET that asks for
// only the first byte (Range: bytes=0-0) is tried too. The answer is one of:
//   ok          the URL answers 200/206 with audio (or no content type)
//   dead        404, 410, 401, 403, a page of text instead of audio, or a host that cannot be reached
//   unverified  429, 5xx, time-outs: the server is busy or slow, so we do NOT call the song dead
import { sleep } from './util.js';

export function classify(status, contentType = '') {
  const ct = String(contentType).toLowerCase().split(';')[0].trim();
  if (status === 200 || status === 206) {
    if (/^(text\/|application\/json|application\/xml)/.test(ct)) return { state: 'dead', reason: `HTTP ${status} but ${ct}, not audio` };
    return { state: 'ok', reason: `HTTP ${status}` };
  }
  if ([401, 403, 404, 410].includes(status)) return { state: 'dead', reason: `HTTP ${status}` };
  return { state: 'unverified', reason: `HTTP ${status}` };
}

async function once(url, method, timeoutMs, fetchImpl) {
  const res = await fetchImpl(url, {
    method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
    headers: method === 'GET' ? { Range: 'bytes=0-0' } : {},
  });
  try { await res.body?.cancel(); } catch { /* nothing to cancel */ }
  return { status: res.status, type: res.headers.get('content-type') || '' };
}

export async function probe(url, { timeoutMs = 12000, retries = 1, retryDelayMs = 2000, fetchImpl = fetch } = {}) {
  let last = { state: 'unverified', reason: 'not checked' };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(retryDelayMs);
    try {
      let r = await once(url, 'HEAD', timeoutMs, fetchImpl);
      let c = classify(r.status, r.type);
      if (c.state !== 'ok') { r = await once(url, 'GET', timeoutMs, fetchImpl); c = classify(r.status, r.type); }
      if (c.state !== 'unverified') return c;     // ok or dead: no need to ask again
      last = c;
    } catch (e) {
      // Node reports the reason in e.cause, or in e.cause.errors when both IPv4 and IPv6 failed
      const codes = [e.cause?.code, e.code, ...(e.cause?.errors ?? []).map((x) => x.code)].filter(Boolean);
      const gone = codes.find((c) => ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'].includes(c));
      // a host that does not exist or refuses connections is dead; a time-out only means "slow right now"
      last = gone
        ? { state: 'dead', reason: `unreachable (${gone})` }
        : { state: 'unverified', reason: `no answer (${codes[0] || e.name})` };
    }
  }
  return last;
}

/** Check many items ({ url, ... }) with a few at a time. Returns the items with { state, reason } added. */
export async function checkAll(items, { concurrency = 6, onProgress = () => {}, ...probeOpts } = {}) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = { ...items[i], ...(await probe(items[i].url, probeOpts)) };
      onProgress(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

/**
 * A big share of failures at once usually means the SOURCE is down (or you are offline), not that every
 * song died. In that case nothing is deactivated unless you pass --force.
 */
export function looksLikeOutage(dead, checked, { ratio = 0.25, minChecked = 10 } = {}) {
  return checked >= minChecked && dead / checked > ratio;
}
