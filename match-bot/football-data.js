/**
 * football-data.js — free second source (football-data.org v4), the same provider
 * the app already reads directly.
 *
 * Free tier facts (checked 2026-11-25 with the app's token):
 *  - 10 requests per minute, NO daily cap ⇒ it costs nothing from the API-Football 100/day.
 *  - Current seasons ARE included (CL 2026/27 league stage, WC 2026 knockout = 104 matches),
 *    unlike API-Football's free plan ("Free plans do not have access to this season").
 *  - Competitions: WC · CL · EC · PL · PD · BL1 · SA · FL1 · DED · PPL · ELC · BSA.
 *  - No events / lineups / statistics / transfers on the free tier.
 *
 * Token: FOOTBALL_DATA_TOKEN (GitHub secret / .env). For local runs it falls back to
 * the token the app already ships in TactIQ2/lib/config.ts.
 */
const fs = require('fs');
const path = require('path');

const FD_BASE = 'https://api.football-data.org/v4';
const GAP_MS = 6500;            // 10/min ⇒ stay just under it
const NET_TIMEOUT_MS = 20000;

/** football-data competition code → API-Football league id (rules.js decides by id). */
const FD_TO_API_LEAGUE = { WC: 1, CL: 2, EC: 4, PL: 39, PD: 140, BL1: 78, SA: 135, FL1: 61, DED: 88, PPL: 94, ELC: 40, BSA: 71 };

/** football-data stage → the round names API-Football used (bracket + rules depend on them). */
const STAGE_ROUND = {
  LAST_64: 'Round of 64',
  LAST_32: 'Round of 32',
  LAST_16: 'Round of 16',
  QUARTER_FINALS: 'Quarter-finals',
  SEMI_FINALS: 'Semi-finals',
  THIRD_PLACE: '3rd Place Final',
  FINAL: 'Final',
};

/** football-data short names → the names content-rules.json knows. */
const NAME_ALIAS = {
  'Man United': 'Manchester United',
  'Man City': 'Manchester City',
  'Barça': 'Barcelona',
  Atleti: 'Atletico Madrid',
  Bayern: 'Bayern Munich',
  Dortmund: 'Borussia Dortmund',
  Milan: 'AC Milan',
  Spurs: 'Tottenham',
};

function token() {
  if (process.env.FOOTBALL_DATA_TOKEN) return process.env.FOOTBALL_DATA_TOKEN.trim();
  try {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'TactIQ2', 'lib', 'config.ts'), 'utf8');
    const m = src.match(/FOOTBALL_DATA_TOKEN[^'"]*['"]([a-f0-9]{16,})['"]/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

let last = 0;
let calls = 0;

async function fd(p) {
  const t = token();
  if (!t) throw new Error('FOOTBALL_DATA_TOKEN is not set');
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0 && calls > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    calls++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NET_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(FD_BASE + p, { headers: { 'X-Auth-Token': t }, signal: ctl.signal });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? `football-data timeout: ${p.split('?')[0]}` : String(e.message || e));
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && attempt === 0) {
      const reset = Number(res.headers.get('x-requestcounter-reset') || 60);
      await new Promise((r) => setTimeout(r, (reset + 1) * 1000));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`football-data ${res.status}: ${(body && body.message) || ''}`.trim());
    return body;
  }
  throw new Error('football-data kept answering 429');
}

/** Team display name in the provider-neutral form the rules expect. */
function teamName(t) {
  if (!t) return '';
  const s = t.shortName || t.name || '';
  return NAME_ALIAS[s] || s;
}

/** football-data match status (+ score.duration) → API-Football short status. */
function shortStatus(m) {
  switch (m.status) {
    case 'FINISHED':
    case 'AWARDED':
      if (m.score && m.score.duration === 'PENALTY_SHOOTOUT') return 'PEN';
      if (m.score && m.score.duration === 'EXTRA_TIME') return 'AET';
      return 'FT';
    case 'IN_PLAY': return 'LIVE';
    case 'PAUSED': return 'HT';
    case 'POSTPONED': return 'PST';
    case 'SUSPENDED': return 'SUSP';
    case 'CANCELLED': return 'CANC';
    default: return 'NS';
  }
}

/**
 * Goals without the shoot-out. football-data's `fullTime` INCLUDES penalties
 * (measured: Germany 1-1 Paraguay, 3-4 on pens ⇒ fullTime 4-5), so it is rebuilt
 * from regularTime + extraTime whenever the match went past 90 minutes.
 */
function goalsOf(m) {
  const s = m.score || {};
  if (s.duration && s.duration !== 'REGULAR' && s.regularTime) {
    const et = s.extraTime || { home: 0, away: 0 };
    return { home: (s.regularTime.home ?? 0) + (et.home ?? 0), away: (s.regularTime.away ?? 0) + (et.away ?? 0) };
  }
  const ft = s.fullTime || {};
  return { home: ft.home ?? null, away: ft.away ?? null };
}

function roundOf(m) {
  if (STAGE_ROUND[m.stage]) return STAGE_ROUND[m.stage];
  const label = String(m.stage || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return m.matchday ? `${label} - ${m.matchday}` : label;
}

/**
 * Converts a football-data match to the API-Football fixture shape the existing
 * code (rules, notify, bracket builder) already understands.
 */
function toFixture(m) {
  const code = m.competition && m.competition.code;
  const goals = goalsOf(m);
  const pens = (m.score && m.score.penalties) || null;
  return {
    fixture: { id: m.id, date: m.utcDate, status: { short: shortStatus(m), elapsed: null } },
    league: {
      id: FD_TO_API_LEAGUE[code] ?? null,
      code,
      name: (m.competition && m.competition.name) || code || '',
      country: (m.area && m.area.name) || '',
      logo: m.competition && m.competition.emblem,
      round: roundOf(m),
    },
    teams: {
      home: { id: m.homeTeam && m.homeTeam.id, name: teamName(m.homeTeam), logo: m.homeTeam && m.homeTeam.crest },
      away: { id: m.awayTeam && m.awayTeam.id, name: teamName(m.awayTeam), logo: m.awayTeam && m.awayTeam.crest },
    },
    goals,
    score: { penalty: pens ? { home: pens.home, away: pens.away } : { home: null, away: null } },
  };
}

module.exports = { fd, token, toFixture, teamName, FD_TO_API_LEAGUE, STAGE_ROUND, get calls() { return calls; } };
