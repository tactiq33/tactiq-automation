/**
 * preview.js — يلاقي «قمم اليوم» (ديربي/كلاسيكو/قمم أبطال/إقصائيّات) ويبعت
 * برومت تذكير + كابشن على تيليغرام. شغّلو الصبح (مثلاً ٩ص) قبل المباريات.
 *
 * التشغيل:
 *   node preview.js                 # قمم اليوم (معاينة)
 *   node preview.js --send          # يبعت على تيليغرام
 *   node preview.js 2026-07-18 --send
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { build, formatMessage, sendTelegram } = require('./notify');

const KEY = process.env.FOOTBALL_API_KEY;
const HOST = 'https://v3.football.api-sports.io';
const RULES = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'content-rules.json'), 'utf8'));
const SEND = process.argv.includes('--send');
const dateArg = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const DATE = dateArg || new Date().toISOString().slice(0, 10);

// القرار كلّه من `rules.js` — أرقام البطولات لا أسماؤها، ومطابقة كلمة كاملة
// للأندية. النسخة السابقة كانت هنا محلّيًّا، وهي التي مرّقت دوري البرازيل.
const { isBigClub, rivalryOf: rivalryTitle, leagueWeight, isBigCompetition, isKnockout } = require('./rules');

async function api(p) {
  const res = await fetch(HOST + p, { headers: { 'x-apisports-key': KEY } });
  const j = await res.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors));
  return j;
}

// هل هالمباراة قمّة؟ يرجّع {big, title} أو null
function bigFixture(f) {
  const h = f.teams.home.name, a = f.teams.away.name;
  const round = f.league.round;
  const w = leagueWeight(f.league);

  // شرط أساسيّ: البطولة نفسها من قائمتنا. بلاه كان ديربي بدوري صغير أو نادٍ
  // اسمه يشبه نادياً كبيراً يفتح الباب لأيّ مباراة في العالم.
  if (w === 0) return null;

  const title = rivalryTitle(h, a);
  const twoBig = isBigClub(h) && isBigClub(a);
  const bigCompKO = isBigCompetition(f.league) && isKnockout(round);

  if (title || twoBig || bigCompKO || (w >= 8 && (isBigClub(h) || isBigClub(a)))) {
    return { title: title || null };
  }
  return null;
}

(async () => {
  if (!KEY) { console.error('❌ FOOTBALL_API_KEY ناقص'); process.exit(1); }
  const j = await api(`/fixtures?date=${DATE}`);
  const fixtures = j.response || [];
  const bigs = [];
  for (const f of fixtures) {
    const b = bigFixture(f);
    if (b) bigs.push({ f, title: b.title });
  }
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
})().catch((e) => { console.error('❌ خطأ:', e.message || e); });
