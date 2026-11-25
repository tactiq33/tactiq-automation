/**
 * provider.js — the single API-Football client every script uses.
 *
 * Why it exists (measured on 2026-11-25):
 *  - The paid plan ended on ~2026-10-08. From then on every collector kept running
 *    on its old cadence (app-data every 5 min, match-bot every 10 min, transfers
 *    twice a day). 2,500 app-data runs failed, and the account ended up SUSPENDED:
 *    every call now answers HTTP 200 with errors.access = "Your account is suspended".
 *  - Each script had its own copy of `api()`. Two of them (transfers, knockout)
 *    swallowed the per-club errors and then pushed an EMPTY list to the server,
 *    wiping the app's transfers and brackets while the run looked "successful".
 *
 * What this module guarantees:
 *  - One budget for the whole day: a free `/status` preflight reads how many calls
 *    are left, and a script refuses to start unless it can finish AND leave a reserve.
 *  - A hard per-run cap (`maxCalls`), so one bug cannot spend the day's quota.
 *  - Account-level refusals (suspended · daily limit · plan · bad key) become a
 *    `ProviderStop`. Scripts catch it with `stopGracefully()`: they print the reason
 *    as a GitHub warning and exit 0 WITHOUT pushing anything.
 *  - Per-minute pacing that follows the plan (free = 10/min ⇒ ~6.5 s between calls).
 *  - A network timeout on every call (Node's fetch has none).
 *
 * The plan is chosen with API_PLAN = free | paid (GitHub variable / .env). Default: free.
 */
const HOST = 'https://v3.football.api-sports.io';

const PLAN = String(process.env.API_PLAN || 'free').toLowerCase() === 'paid' ? 'paid' : 'free';
const IS_FREE = PLAN === 'free';

/** Calls left untouched for manual tools and the server. Overridable: API_RESERVE. */
const DEFAULT_RESERVE = Number(process.env.API_RESERVE || (IS_FREE ? 30 : 300));
const NET_TIMEOUT_MS = Number(process.env.NET_TIMEOUT_MS || 20000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ProviderStop extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'ProviderStop';
    this.kind = kind;
  }
}

/** Human-readable reason for each stop kind (also used in the run log). */
const REASON = {
  'no-key': 'FOOTBALL_API_KEY is not set',
  suspended: 'API-Football account is suspended — open https://dashboard.api-football.com',
  quota: 'API-Football daily request limit reached',
  budget: 'not enough API-Football calls left today (kept for the safety reserve)',
  plan: 'API-Football free plan does not cover this data',
  token: 'API-Football key was rejected',
  paused: 'paused on the free API-Football plan',
};

function hasErrors(errs) {
  if (!errs) return false;
  if (Array.isArray(errs)) return errs.length > 0;
  return typeof errs === 'object' && Object.keys(errs).length > 0;
}

/** Maps the provider's `errors` object to a stop kind, or null for a per-call error. */
function classify(errs) {
  const text = JSON.stringify(errs || {});
  const e = errs && !Array.isArray(errs) ? errs : {};
  if (e.access || /suspended|subscription|expired/i.test(text)) return 'suspended';
  if (e.requests || /request limit|limit for the day/i.test(text)) return 'quota';
  if (e.token || /api key|application key|missing.*key/i.test(text)) return 'token';
  if (e.plan || /free plans? do not/i.test(text)) return 'plan';
  if (e.rateLimit || /too many requests|per minute/i.test(text)) return 'rate';
  return null;
}

async function timedFetch(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NET_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`network timeout after ${NET_TIMEOUT_MS}ms: ${String(url).split('?')[0]}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} o
 * @param {string} o.label      script name, shown in every log line
 * @param {number} o.maxCalls   hard cap for this run
 * @param {number} [o.reserve]  calls that must stay unused after this run
 */
function createClient({ label, maxCalls, reserve = DEFAULT_RESERVE }) {
  const KEY = process.env.FOOTBALL_API_KEY;
  const st = { calls: 0, remaining: null, limit: null, perMinute: null, gapMs: IS_FREE ? 6500 : 350, last: 0 };

  function readHeaders(res) {
    const rem = parseInt(res.headers.get('x-ratelimit-requests-remaining') || '', 10);
    const lim = parseInt(res.headers.get('x-ratelimit-requests-limit') || '', 10);
    const pm = parseInt(res.headers.get('x-ratelimit-limit') || '', 10);
    if (Number.isFinite(rem)) st.remaining = rem;
    if (Number.isFinite(lim)) st.limit = lim;
    if (Number.isFinite(pm) && pm > 0) {
      st.perMinute = pm;
      // pace a little under the per-minute limit (10/min ⇒ 6.5 s)
      st.gapMs = Math.max(350, Math.ceil(60000 / pm) + 500);
    }
  }

  /**
   * Free check before spending anything. `/status` is documented as not counting
   * toward the daily quota. Throws ProviderStop when the run must not start.
   */
  async function preflight(needed) {
    if (!KEY) throw new ProviderStop('no-key', REASON['no-key']);
    const res = await timedFetch(HOST + '/status', { headers: { 'x-apisports-key': KEY } });
    readHeaders(res);
    const body = await res.json().catch(() => ({}));
    if (hasErrors(body.errors)) {
      const kind = classify(body.errors) || 'token';
      throw new ProviderStop(kind, `${REASON[kind]} (${JSON.stringify(body.errors).slice(0, 160)})`);
    }
    const r = body.response || {};
    const req = r.requests || {};
    if (Number.isFinite(req.limit_day) && Number.isFinite(req.current)) {
      st.limit = req.limit_day;
      st.remaining = Math.max(0, req.limit_day - req.current);
    }
    const plan = (r.subscription && r.subscription.plan) || '?';
    const need = Math.min(needed, maxCalls);
    // stderr بقصد: live-ids يطبع الأرقام وحدها على stdout ليقرأها الـworkflow.
    console.error(`[${label}] API-Football plan=${plan} · left today=${st.remaining ?? '?'}/${st.limit ?? '?'} · this run needs ≤${need} · reserve ${reserve}`);
    if (st.remaining != null && st.remaining < need + reserve) {
      throw new ProviderStop('budget', `${REASON.budget}: ${st.remaining} left, run needs ${need} + reserve ${reserve}`);
    }
    return { plan, remaining: st.remaining, limit: st.limit };
  }

  /** One provider call. Returns `response` (array/object). */
  async function api(path) {
    if (!KEY) throw new ProviderStop('no-key', REASON['no-key']);
    if (st.calls >= maxCalls) throw new ProviderStop('budget', `per-run cap of ${maxCalls} calls reached`);
    if (st.remaining != null && st.remaining <= reserve) {
      throw new ProviderStop('budget', `${REASON.budget}: ${st.remaining} left`);
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = st.last + st.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      st.last = Date.now();
      st.calls++;

      const res = await timedFetch(HOST + path, { headers: { 'x-apisports-key': KEY } });
      readHeaders(res);
      if (res.status === 429) {
        if (attempt === 0) { await sleep(61000); continue; }
        throw new ProviderStop('quota', REASON.quota + ' (HTTP 429)');
      }
      const body = await res.json().catch(() => null);
      if (!body) throw new Error(`provider returned no JSON (HTTP ${res.status}) for ${path.split('?')[0]}`);
      if (hasErrors(body.errors)) {
        const kind = classify(body.errors);
        if (kind === 'rate' && attempt === 0) { await sleep(61000); continue; }
        if (kind && kind !== 'rate') {
          throw new ProviderStop(kind, `${REASON[kind]} (${JSON.stringify(body.errors).slice(0, 160)})`);
        }
        throw new Error('provider: ' + JSON.stringify(body.errors).slice(0, 200));
      }
      return body.response == null ? [] : body.response;
    }
    throw new ProviderStop('rate', 'per-minute limit kept refusing');
  }

  return {
    api,
    preflight,
    get calls() { return st.calls; },
    get remaining() { return st.remaining; },
  };
}

/**
 * Turns a ProviderStop into a clean, readable exit (code 0) with a GitHub warning.
 * Returns false for any other error so the caller can fail loudly as before.
 */
function stopGracefully(label, err) {
  if (!(err instanceof ProviderStop)) return false;
  const msg = `${label} stopped: ${err.message}`;
  console.log(msg + ' — nothing was pushed or sent.');
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${label}::${msg}`);
  process.exitCode = 0;
  return true;
}

/** For features that cannot fit 100 calls/day: log why and exit 0. */
function pausedOnFreePlan(label, why) {
  const msg = `${label}: ${REASON.paused}. ${why}`;
  console.error(msg);
  if (process.env.GITHUB_ACTIONS) console.error(`::notice title=${label}::${msg}`);
}

module.exports = { HOST, PLAN, IS_FREE, ProviderStop, createClient, stopGracefully, pausedOnFreePlan, classify, sleep };
