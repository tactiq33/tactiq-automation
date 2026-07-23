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

function norm(s) { return (s || '').toString().toLowerCase(); }
function isBigClub(name) { return RULES.bigClubs.some((b) => norm(name).includes(norm(b)) || norm(b).includes(norm(name))); }
function rivalryTitle(h, a) {
  const pair = RULES.rivalries.find((p) => {
    const [x, y] = p.map(norm);
    return (norm(h).includes(x) && norm(a).includes(y)) || (norm(h).includes(y) && norm(a).includes(x));
  });
  if (!pair) return null;
  const key = pair.map(norm).sort().join('|');
  if (key.includes('real madrid') && key.includes('barcelona')) return 'EL CLASICO';
  return 'THE DERBY';
}
function leagueWeight(name) {
  for (const [n, w] of Object.entries(RULES.priorityLeagues)) {
    if (norm(name).includes(norm(n)) || norm(n).includes(norm(name))) return w;
  }
  return 0;
}
function isKnockout(round) { return RULES.knockoutKeywords.some((k) => norm(round).includes(norm(k))); }

async function api(p) {
  const res = await fetch(HOST + p, { headers: { 'x-apisports-key': KEY } });
  const j = await res.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors));
  return j;
}

// هل هالمباراة قمّة؟ يرجّع {big, title} أو null
function bigFixture(f) {
  const h = f.teams.home.name, a = f.teams.away.name;
  const comp = f.league.name, round = f.league.round;
  const title = rivalryTitle(h, a);
  const twoBig = isBigClub(h) && isBigClub(a);
  const bigCompKO = /world cup|champions|euro|copa|nations|كأس|أبطال/i.test(comp) && isKnockout(round);
  const w = leagueWeight(comp);
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
      competition: f.league.name,
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
