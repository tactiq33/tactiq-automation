/**
 * watch.js — يراقب مباراة حيّة عبر API-Football، وبس يصير حدث جديد (هدف/بطاقة/نهاية)
 * بيبني برومت + كابشن وبيبعتهم على تيليغرام (حسب decide.js).
 *
 * التشغيل:
 *   node watch.js --fixture=ID                 # يراقب كل دقيقتين (افتراضيّ)
 *   node watch.js --fixture=ID --interval=3    # كل ٣ دقايق (توفير طلبات)
 *   node watch.js --fixture=ID --once          # فحص مرّة وحدة (للتجربة)
 *   node watch.js --fixture=ID --send          # يبعت فعليًّا على تيليغرام
 *
 * لإيجاد رقم المباراة:  node find-fixture.js 2026-07-14 France
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { build, formatMessage, sendTelegram } = require('./notify');
const { decide } = require('./decide');
const { isBigCompetition } = require('./rules');

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith('--' + name));
  if (!a) return def;
  return a.includes('=') ? a.split('=')[1] : true;
}
const FIXTURE = arg('fixture');
const INTERVAL = parseFloat(arg('interval', '2')) * 60 * 1000;
const ONCE = !!arg('once', false);
const SEND = !!arg('send', false);

const STATE_DIR = path.resolve(__dirname, 'state');
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, `fixture-${FIXTURE}.json`);

// أسماء المنتخبات → كود ISO (للأعلام). أضف حسب الحاجة.
const NAME2CODE = {
  France: 'fr', Spain: 'es', Morocco: 'ma', Argentina: 'ar', Brazil: 'br', England: 'en',
  Portugal: 'pt', Germany: 'de', Italy: 'it', Netherlands: 'nl', Belgium: 'be', Croatia: 'hr',
  Egypt: 'eg', 'Saudi Arabia': 'sa', Qatar: 'qa', USA: 'us', 'United States': 'us',
  Mexico: 'mx', Japan: 'jp', 'South Korea': 'kr', Senegal: 'sn', Nigeria: 'ng', Colombia: 'co',
  Uruguay: 'uy', Denmark: 'dk', Switzerland: 'ch', Poland: 'pl', Serbia: 'rs', Ghana: 'gh',
};
function codeOf(name) { return NAME2CODE[name] || ''; }

// كلّ النداءات من العميل الموحّد: سقف للجولة، حصّة محروسة، ووقوف هادئ عند تعليق
// الحساب أو انتهاء الحصّة. فحصة واحدة = نداءين (المباراة + الأحداث).
const { createClient, IS_FREE, ProviderStop, stopGracefully, pausedOnFreePlan } = require('./provider');
const client = createClient({ label: 'watch', maxCalls: ONCE ? 2 : 400 });
async function api(p) {
  return { response: await client.api(p) };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { seen: [], finalSent: false }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8'); }

function sig(e) { return `${e.type}|${e.detail}|${e.player && e.player.id}|${e.time.elapsed}|${e.time.extra || 0}`; }

// يبني كائن الحدث تبعنا من حدث API + بيانات المباراة
function toEvent(apiEv, fx) {
  const league = fx.league || {};
  const teams = fx.teams || {};
  const goals = fx.goals || {};
  const home = { name: teams.home.name, code: codeOf(teams.home.name), score: goals.home };
  const away = { name: teams.away.name, code: codeOf(teams.away.name), score: goals.away };
  const scoringTeam = apiEv.team.id === teams.home.id ? teams.home : teams.away;

  let type = 'goal';
  if (apiEv.type === 'Card' && /red/i.test(apiEv.detail)) type = 'red_card';
  else if (apiEv.type === 'Goal') type = 'goal';

  return {
    type,
    // رقم البطولة إلزاميّ: `decide.js` يقرّر به، والاسم للعرض فقط.
    leagueId: league.id != null ? Number(league.id) : null,
    competition: league.name || '',
    country: (league.country || ''),
    stage: league.round || '',
    player: apiEv.player && apiEv.player.name,
    playerEn: apiEv.player && apiEv.player.name,
    team: scoringTeam.name,
    teamCode: codeOf(scoringTeam.name),
    teamEn: scoringTeam.name,
    min: apiEv.time.elapsed + (apiEv.time.extra ? '+' + apiEv.time.extra : ''),
    home, away,
  };
}

async function handle(ev, label) {
  const d = decide(ev);

  // ⚠️ قاعدة المالك: كلّ رسالة تُبعث لازم تحمل برومبتًا يُستعمل. الحدث الذي لا
  // يستحقّ تصميمًا لا تُبعث عنه رسالة أبدًا — يُطبع في السجلّ ويُنتهى.
  // (المسار القديم كان يبعث نصًّا «صار هدف وما منعمل تصميم»، وهو بلا فائدة.)
  if (d.action !== 'aiDesign') {
    console.log('⏭️', label, '— بلا إرسال:', d.reasons.join(' • '));
    return;
  }

  const b = build(ev);
  const msg = `[${label}] 🅰️ تصميم AI (${d.reasons.join(' • ')})\n\n` + formatMessage(ev, b);
  console.log('\n──────────────\n' + msg + '\n──────────────');
  if (SEND) {
    try { await sendTelegram(msg); console.log('✅ انبعت على تيليغرام'); }
    catch (e) { console.log('⚠️ تعذّر البعث:', e.message); }
  }
}

async function poll() {
  const state = loadState();

  const fxRes = await api(`/fixtures?id=${FIXTURE}`);
  const fx = fxRes.response && fxRes.response[0];
  if (!fx) { console.log('⚠️ ما لقيت المباراة (تأكّد من الرقم/الوصول).'); return true; }

  const status = fx.fixture.status.short; // NS, 1H, HT, 2H, ET, FT...
  const t = fx.teams, g = fx.goals;
  console.log(`⏱️ ${new Date().toLocaleTimeString()} | ${t.home.name} ${g.home}-${g.away} ${t.away.name} | ${status} ${fx.fixture.status.elapsed || ''}'`);

  if (status === 'NS') { console.log('   المباراة ما بلّشت بعد.'); return false; }

  // الأحداث
  const evRes = await api(`/fixtures/events?fixture=${FIXTURE}`);
  const events = evRes.response || [];
  for (const e of events) {
    if (e.type !== 'Goal' && !(e.type === 'Card' && /red/i.test(e.detail))) continue;
    const s = sig(e);
    if (state.seen.includes(s)) continue;
    state.seen.push(s);
    const ev = toEvent(e, fx);
    await handle(ev, ev.type === 'goal' ? '⚽ هدف' : '🟥 طرد');
  }
  saveState(state);

  // نهاية المباراة
  const finished = ['FT', 'AET', 'PEN'].includes(status);
  if (finished && !state.finalSent) {
    const round = fx.league.round || '';
    const knockout = /final|semi|quarter|نهائي|نصف|ربع|knockout|round of 16|ثمن/i.test(round);
    // ⚠️ برقم البطولة لا باسمها: التعبير النمطيّ القديم كان يمرّق أيّ بطولة فيها
    // كلمة copa (Copa do Brasil · Libertadores · Copa Argentina) كبطولة كبرى.
    const bigComp = isBigCompetition(fx.league);
    const winner = g.home > g.away ? t.home : (g.away > g.home ? t.away : null);
    const base = {
      leagueId: fx.league.id != null ? Number(fx.league.id) : null,
      competition: fx.league.name, country: fx.league.country || '', stage: round,
      home: { name: t.home.name, code: codeOf(t.home.name), score: g.home },
      away: { name: t.away.name, code: codeOf(t.away.name), score: g.away },
    };
    let ev;
    if (winner && knockout && bigComp) {
      const isFinal = /^final|^\s*final|النهائي$/i.test(round) || /grand final/i.test(round);
      ev = Object.assign({}, base, {
        type: isFinal ? 'champion' : 'advance',
        team: winner.name, teamCode: codeOf(winner.name), teamEn: winner.name,
        finalCity: process.env.FINAL_CITY || '',
      });
    } else {
      ev = Object.assign({}, base, {
        type: 'final',
        team: (g.home > g.away ? t.home.name : g.away > g.home ? t.away.name : ''),
        teamCode: codeOf(g.home >= g.away ? t.home.name : t.away.name),
      });
    }
    await handle(ev, ev.type === 'champion' ? '🏆 بطل' : ev.type === 'advance' ? '🎉 تأهّل' : '⏱️ النهاية');
    state.finalSent = true;
    saveState(state);
    return true; // خلصنا
  }
  return finished;
}

(async () => {
  if (!FIXTURE) { console.error('❌ لازم --fixture=ID (جيبو بـ find-fixture.js)'); process.exit(1); }
  if (IS_FREE && !process.argv.includes('--force')) {
    pausedOnFreePlan('watch', 'Each check costs 2 calls; live watching does not fit 100/day. Use --force for a one-off manual check.');
    return;
  }

  console.log(`👀 بمراقبة المباراة ${FIXTURE} | كل ${INTERVAL / 60000} دقيقة | ${SEND ? 'بعث تيليغرام مفعّل' : 'وضع طباعة'}`);
  try {
    await client.preflight(2);
  } catch (e) {
    if (stopGracefully('watch', e)) return;
    throw e;
  }

  if (ONCE) {
    try { await poll(); } catch (e) { if (!stopGracefully('watch', e)) throw e; }
    return; // خروج طبيعيّ بعد تفريغ الاتصالات
  }

  const timer = setInterval(async () => {
    try {
      const done = await poll();
      if (done) { console.log('🏁 المباراة خلصت — إيقاف المراقبة.'); clearInterval(timer); }
    } catch (e) {
      // تعليق الحساب أو انتهاء الحصّة ما بيتصلّح بالإعادة: وقّف بدل ما تكمّل تصرف.
      if (e instanceof ProviderStop) { stopGracefully('watch', e); clearInterval(timer); return; }
      console.log('⚠️ خطأ بالفحص (بيكمّل):', e.message);
    }
  }, INTERVAL);

  // فحص أوّل فوريّ
  try { await poll(); } catch (e) {
    if (e instanceof ProviderStop) { stopGracefully('watch', e); clearInterval(timer); return; }
    console.log('⚠️', e.message);
  }
})().catch((e) => { console.error('❌ watch failed:', e.message || e); process.exit(1); });
