/**
 * push-app-data.js — الساحب: يجمع بيانات مباريات اليوم ويدفعها إلى سيرفرنا،
 * ليقرأها التطبيق من هناك.
 *
 * ⚠️ ليش يشتغل هنا لا داخل السيرفر — قياس لا رأي:
 * المزوّد يرفض جزءًا من النداءات القادمة من عناوين Cloudflare (6 من 10 تنجح، بينما
 * 10 من 10 تنجح من جهاز عاديّ ومن GitHub Actions). وإعادة المحاولة داخل الـWorker
 * لا تكفي لأنّ عنوان الخروج نفسه. فالسحب يصير من هنا، والسيرفر يخدم من المخزون.
 *
 * التشغيل:
 *   node match-bot/push-app-data.js            سحب وطبع بلا دفع (تجربة)
 *   node match-bot/push-app-data.js --push     سحب ودفع إلى السيرفر
 *
 * البيئة:
 *   FOOTBALL_API_KEY   مفتاح API-Football
 *   WORKER_URL         عنوان السيرفر (بلا شرطة في النهاية)
 *   INGEST_TOKEN       نفس السرّ الموجود على السيرفر
 *
 * ── ضبط الكلفة ──────────────────────────────────────────────────────────
 * الحصّة 7500 نداء/يوم ويشاركها بوت تيليغرام. لذلك:
 *  · نداء واحد لقائمة اليوم كلّها (لا نداء لكلّ بطولة)
 *  · تفاصيل (أحداث + تشكيلة + إحصائيّات) **للمباريات الجارية فقط**، وثلاثة نداءات
 *    لكلّ واحدة، وبسقف أعلى للعدد
 *  · المباريات المنتهية تُسحب تفاصيلها **مرّة واحدة**: إن كانت موجودة في المخزون
 *    السابق فلا تُسحب مرّة أخرى — بياناتها لا تتغيّر
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const KEY = process.env.FOOTBALL_API_KEY;
const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.INGEST_TOKEN;
const HOST = 'https://v3.football.api-sports.io';
const PUSH = process.argv.includes('--push');

/** نفس قائمة البطولات المستعملة في البوت وفي السيرفر. */
const LEAGUES = [1, 2, 3, 4, 5, 6, 7, 9, 15, 39, 45, 61, 66, 78, 81, 135, 137, 140, 143, 307, 528, 531, 556, 848];

/** أقصى عدد مباريات تُسحب تفاصيلها في الجولة الواحدة (حماية للحصّة). */
const MAX_LIVE = 8;
const MAX_NEW_FINISHED = 6;

const LIVE = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'];
const DONE = ['FT', 'AET', 'PEN'];

let calls = 0;

async function api(path) {
  calls++;
  const res = await fetch(HOST + path, { headers: { 'x-apisports-key': KEY } });
  const body = await res.json();
  if (body.errors && !Array.isArray(body.errors) && Object.keys(body.errors).length) {
    throw new Error('provider: ' + JSON.stringify(body.errors));
  }
  return body.response || [];
}

/* ───────────────────────── تصغير الخرج ───────────────────────── */
// التطبيق يعرض هذا فقط، والجواب الخام ضخم ويُحمَّل على شبكة الهاتف بلا فائدة.

function slimFixture(f) {
  return {
    id: f.fixture.id,
    utcDate: f.fixture.date,
    status: f.fixture.status.short,
    elapsed: f.fixture.status.elapsed,
    leagueId: f.league.id,
    league: f.league.name,
    country: f.league.country,
    logo: f.league.logo,
    round: f.league.round,
    home: { id: f.teams.home.id, name: f.teams.home.name, crest: f.teams.home.logo, score: f.goals.home },
    away: { id: f.teams.away.id, name: f.teams.away.name, crest: f.teams.away.logo, score: f.goals.away },
  };
}

const slimEvent = (e) => ({
  minute: e.time.elapsed,
  extra: e.time.extra || null,
  teamId: e.team.id,
  type: e.type,
  detail: e.detail,
  player: e.player && e.player.name,
  assist: e.assist && e.assist.name,
});

const slimPlayer = (x) => ({ id: x.player.id, name: x.player.name, number: x.player.number, pos: x.player.pos, grid: x.player.grid });

const slimLineup = (l) => ({
  teamId: l.team.id,
  formation: l.formation,
  coach: l.coach && { name: l.coach.name, photo: l.coach.photo },
  startXI: (l.startXI || []).map(slimPlayer),
  subs: (l.substitutes || []).map(slimPlayer),
});

function slimStats(s) {
  const stats = {};
  for (const it of s.statistics || []) stats[it.type] = it.value;
  return { teamId: s.team.id, stats };
}

/* ───────────────────────── الجولة ───────────────────────── */

/** المخزون السابق من السيرفر: نداء HTTP واحد لا يكلّف من حصّة المزوّد. */
async function previousDetails() {
  if (!WORKER) return {};
  try {
    const res = await fetch(`${WORKER}/football/matches`);
    if (!res.ok) return {};
    const body = await res.json();
    const out = {};
    // القائمة لا تحمل التفاصيل، فتُسأل المباريات المنتهية واحدة واحدة عن وجودها.
    // نداء واحد لكلّ مباراة منتهية على **سيرفرنا** (مجّانيّ)، لا على المزوّد.
    for (const m of body.matches || []) {
      if (!DONE.includes(m.status)) continue;
      const r = await fetch(`${WORKER}/football/fixture/${m.id}`);
      if (!r.ok) continue;
      const d = await r.json();
      if (!d.pending) out[String(m.id)] = { events: d.events, lineups: d.lineups, statistics: d.statistics };
    }
    return out;
  } catch {
    return {};
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ⚠️ النداءات **متسلسلة مع فاصل**، لا متوازية — قياس لا احتياط:
 * أوّل نسخة نادت الثلاثة بـ`Promise.all`، فرفض المزوّد اثنين من ستّ مباريات
 * برسالة «تجاوزت الحدّ في الدقيقة» رغم أنّ المستهلك كان أقلّ من 100 من 7500.
 * ⇒ عنده حدّ على **الدفعة السريعة** لا على المجموع. والساحب لا يستعجل: ثلاث
 * ثوانٍ زيادة في جولة كلّ خمس دقائق لا تُلاحظ، وسقوط البيانات يُلاحظ.
 */
const GAP_MS = 350;

async function detailsFor(id) {
  const events = await api(`/fixtures/events?fixture=${id}`);
  await sleep(GAP_MS);
  const lineups = await api(`/fixtures/lineups?fixture=${id}`);
  await sleep(GAP_MS);
  const statistics = await api(`/fixtures/statistics?fixture=${id}`);
  return { events: events.map(slimEvent), lineups: lineups.map(slimLineup), statistics: statistics.map(slimStats) };
}

(async () => {
  if (!KEY) { console.error('FOOTBALL_API_KEY missing'); process.exit(1); }

  const date = new Date().toISOString().slice(0, 10);
  const raw = await api(`/fixtures?date=${date}`);
  const matches = raw.filter((f) => LEAGUES.includes(f.league.id)).map(slimFixture);
  console.log(`fixtures today: ${raw.length} · ours: ${matches.length}`);

  const kept = await previousDetails();
  console.log(`details already stored: ${Object.keys(kept).length}`);

  const live = matches.filter((m) => LIVE.includes(m.status)).slice(0, MAX_LIVE);
  const newlyDone = matches
    .filter((m) => DONE.includes(m.status) && !kept[String(m.id)])
    .slice(0, MAX_NEW_FINISHED);

  const details = { ...kept };
  const failed = [];

  for (const m of [...live, ...newlyDone]) {
    await sleep(GAP_MS);
    try {
      details[String(m.id)] = await detailsFor(m.id);
      console.log(`  details ✔ ${m.id}  ${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name}  [${m.status}]`);
    } catch (e) {
      failed.push(m);
      console.log(`  details ✖ ${m.id}: ${e.message}`);
    }
  }

  // جولة ثانية للفاشلين بعد نفس ثانيتين: الرفض من نوع الدفعة السريعة يزول بالانتظار.
  if (failed.length) {
    console.log(`retrying ${failed.length} after a pause…`);
    await sleep(2500);
    for (const m of failed) {
      await sleep(GAP_MS);
      try {
        details[String(m.id)] = await detailsFor(m.id);
        console.log(`  retry ✔ ${m.id}`);
      } catch (e) {
        console.log(`  retry ✖ ${m.id}: ${e.message}`);
      }
    }
  }

  const snapshot = { generatedAt: new Date().toISOString(), matches, details };
  console.log(`provider calls this run: ${calls} · matches: ${matches.length} · details: ${Object.keys(details).length}`);

  if (!PUSH) { console.log('(dry run — add --push to send)'); return; }
  if (!WORKER || !TOKEN) { console.error('WORKER_URL or INGEST_TOKEN missing'); process.exit(1); }

  const res = await fetch(`${WORKER}/football/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(snapshot),
  });
  const out = await res.text();
  console.log(`push → HTTP ${res.status} ${out}`);
  if (!res.ok) process.exit(1);
})().catch((e) => {
  console.error('push-app-data failed:', e.message || e);
  process.exit(1);
});
