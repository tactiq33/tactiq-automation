/**
 * preview.js — يلاقي «قمم اليوم» (ديربي/كلاسيكو/قمم أبطال/إقصائيّات) ويبعت
 * برومت تذكير + كابشن على تيليغرام. شغّلو الصبح (مثلاً ٩ص) قبل المباريات.
 *
 * التشغيل:
 *   node preview.js                 # قمم اليوم (معاينة)
 *   node preview.js --send          # يبعت على تيليغرام
 *   node preview.js 2026-07-18 --send
 *
 * ── المصدر ──────────────────────────────────────────────────────────────
 * على الباقة المجّانيّة (API_PLAN=free، الافتراضيّ): football-data.org — مجّانيّ بلا
 * سقف يوميّ ويغطّي الموسم الحاليّ ⇒ صفر نداء من حصّة API-Football (100/يوم).
 * على المدفوع (API_PLAN=paid): API-Football (نداء واحد، يغطّي السعوديّ وغيره)، وإذا
 * رفض لأيّ سبب يرجع لـfootball-data بدل ما يفشل.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { build, formatMessage, sendTelegram } = require('./notify');
const { createClient, IS_FREE, ProviderStop } = require('./provider');
const FD = require('./football-data');

const SEND = process.argv.includes('--send');
const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const DATE = dateArg || new Date().toISOString().slice(0, 10);

// القرار كلّه من `rules.js` — أرقام البطولات لا أسماؤها، ومطابقة كلمة كاملة
// للأندية. النسخة السابقة كانت هنا محلّيًّا، وهي التي مرّقت دوري البرازيل.
const { bigMatch } = require('./rules');

// هل هالمباراة قمّة؟ يرجّع {big, title} أو null
function bigFixture(f) {
  const h = f.teams.home.name, a = f.teams.away.name;
  // نفس تعريف «المباراة القويّة» المستعمل في `decide.js` — من `rules.js`، نسخة واحدة.
  return bigMatch({ league: f.league, home: h, away: a, round: f.league.round });
}

async function fromFootballData() {
  const next = new Date(Date.parse(DATE + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const body = await FD.fd(`/matches?dateFrom=${DATE}&dateTo=${next}`);
  return (body.matches || [])
    .filter((m) => String(m.utcDate || '').slice(0, 10) === DATE)
    .map(FD.toFixture);
}

async function fromApiFootball() {
  const client = createClient({ label: 'preview', maxCalls: 1 });
  await client.preflight(1);
  return client.api(`/fixtures?date=${DATE}`);
}

async function loadFixtures() {
  if (IS_FREE) {
    console.log('source: football-data.org (free plan — 0 API-Football calls)');
    return fromFootballData();
  }
  try {
    const list = await fromApiFootball();
    console.log('source: API-Football');
    return list;
  } catch (e) {
    const why = e instanceof ProviderStop ? e.message : String(e.message || e);
    console.log(`API-Football unavailable (${why}) — falling back to football-data.org`);
    return fromFootballData();
  }
}

(async () => {
  const fixtures = await loadFixtures();
  const bigs = [];
  for (const f of fixtures) {
    const b = bigFixture(f);
    if (b) bigs.push({ f, title: b.title });
  }
  console.log(`fixtures on ${DATE}: ${fixtures.length}`);
  if (bigs.length === 0) { console.log(`ℹ️ ما في قمم مميّزة بتاريخ ${DATE}.`); return; }

  console.log(`🔥 ${bigs.length} قمّة اليوم (${DATE}):`);
  for (const { f, title } of bigs) {
    const t = new Date(f.fixture.date).toLocaleTimeString();
    const ev = {
      type: 'preview',
      leagueId: f.league.id != null ? Number(f.league.id) : null,
      competition: f.league.name,
      country: f.league.country || '',
      stage: f.league.round,
      time: t,
      title,
      home: { name: f.teams.home.name, nameEn: f.teams.home.name },
      away: { name: f.teams.away.name, nameEn: f.teams.away.name },
    };
    const b = build(ev);
    const msg = `[🔥 قمّة اليوم] ${title || ''}\n\n` + formatMessage(ev, b);
    console.log('\n──────────────\n' + msg + '\n──────────────');
    if (SEND) {
      try { await sendTelegram(msg); console.log('✅ انبعت'); }
      catch (e) { console.log('⚠️ تعذّر البعث:', e.message); }
    }
  }
})().catch((e) => {
  // المعاينة تذكير صباحيّ: فشل مصدر لا يجب أن يُسقط الـworkflow، بس لازم ينقرا السبب.
  console.error('❌ preview: ' + (e.message || e));
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=preview::${e.message || e}`);
});
