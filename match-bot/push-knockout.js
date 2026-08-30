/**
 * push-knockout.js — يبني شجرة الأدوار الإقصائيّة **بخيوط موصولة حقيقيّة** ويدفعها.
 *
 * ⚠️ المزوّد لا يعطي شجرة ولا روابط بين المباريات. ما يعطيه: مباريات كلّ دور
 * بأسماء الفرق ونتائجها. فالربط يُحسَب هنا: فائز كلّ مواجهة يُطابَق بالفريق الذي
 * يظهر في الدور التالي ⇒ الخيط بين المباراتين **مستنتَج من البيانات لا مرسوم
 * وهميًّا**. هذا هو الفرق عن الشكل القديم الذي كان يرسم خطوطًا بلا معنى.
 *
 * المواجهة قد تكون من مباراتين (ذهاب وعودة) كما في أبطال أوروبا، فيُحسَب المجموع.
 * وقد تكون مباراة واحدة كما في المونديال.
 *
 * الكلفة: نداء واحد لكلّ بطولة (~9 نداءات)، ويكفي تشغيله مرّتين يوميًّا.
 *
 * التشغيل:
 *   node match-bot/push-knockout.js           بناء وطبع
 *   node match-bot/push-knockout.js --push    بناء ودفع
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const KEY = process.env.FOOTBALL_API_KEY;
const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.INGEST_TOKEN;
const HOST = 'https://v3.football.api-sports.io';
const PUSH = process.argv.includes('--push');

/** البطولات ذات الأدوار الإقصائيّة، ورمزها في التطبيق. */
const COMPS = [
  { id: 1, code: 'WC', name: 'World Cup' },
  { id: 2, code: 'CL', name: 'UEFA Champions League' },
  { id: 3, code: 'EL', name: 'UEFA Europa League' },
  { id: 848, code: 'UECL', name: 'Conference League' },
  { id: 4, code: 'EURO', name: 'Euro' },
  { id: 6, code: 'AFCON', name: 'Africa Cup of Nations' },
  { id: 7, code: 'ASIAN', name: 'Asian Cup' },
  { id: 9, code: 'COPA', name: 'Copa America' },
  { id: 15, code: 'CWC', name: 'Club World Cup' },
];

/** ترتيب الأدوار من الأوسع إلى النهائي. أيّ دور غير مذكور يُتخطّى (المجموعات مثلًا). */
const ORDER = [
  'Round of 64', 'Round of 32', 'Round of 16', '8th Finals',
  'Quarter-finals', 'Quarter-Finals', 'Semi-finals', 'Semi-Finals',
  '3rd Place Final', 'Final',
];

const SEASON = Number(process.env.SEASON || new Date().getUTCFullYear());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

const done = (s) => ['FT', 'AET', 'PEN'].includes(s);

/**
 * يجمع مباريات الدور في **مواجهات**: مباراة واحدة، أو ذهاب وعودة لنفس الفريقين.
 * مفتاح المواجهة يُبنى من رقمَي الفريقين مرتّبين، فالعودة تُلحق بالذهاب.
 */
function toTies(fixtures) {
  const map = new Map();
  for (const f of fixtures) {
    const a = f.teams.home.id, b = f.teams.away.id;
    if (!a || !b) continue;
    const key = [a, b].sort((x, y) => x - y).join('-');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }

  const ties = [];
  for (const [key, legs] of map) {
    legs.sort((x, y) => new Date(x.fixture.date) - new Date(y.fixture.date));
    const first = legs[0];
    const teams = [
      { id: first.teams.home.id, name: first.teams.home.name, logo: first.teams.home.logo },
      { id: first.teams.away.id, name: first.teams.away.name, logo: first.teams.away.logo },
    ];

    // المجموع على مباراتين، أو نتيجة المباراة الواحدة.
    const agg = { [teams[0].id]: 0, [teams[1].id]: 0 };
    let allDone = true;
    let penWinner = null;
    for (const l of legs) {
      if (!done(l.fixture.status.short)) { allDone = false; continue; }
      agg[l.teams.home.id] += l.goals.home ?? 0;
      agg[l.teams.away.id] += l.goals.away ?? 0;
      // ركلات الترجيح تحسم المتساوي، والمزوّد يضعها في score.penalty
      const p = l.score && l.score.penalty;
      if (p && p.home != null && p.away != null && p.home !== p.away) {
        penWinner = p.home > p.away ? l.teams.home.id : l.teams.away.id;
      }
    }

    let winner = null;
    if (allDone) {
      if (agg[teams[0].id] !== agg[teams[1].id]) {
        winner = agg[teams[0].id] > agg[teams[1].id] ? teams[0].id : teams[1].id;
      } else if (penWinner) {
        winner = penWinner;
      }
    }

    ties.push({
      key,
      legs: legs.map((l) => ({
        id: l.fixture.id,
        utcDate: l.fixture.date,
        status: l.fixture.status.short,
        homeId: l.teams.home.id,
        awayId: l.teams.away.id,
        homeScore: l.goals.home ?? null,
        awayScore: l.goals.away ?? null,
      })),
      teams,
      aggregate: allDone ? [agg[teams[0].id], agg[teams[1].id]] : null,
      winnerId: winner,
      // ترتيب زمنيّ لعرض المواجهات بنفس تسلسل القرعة
      sortAt: first.fixture.date,
    });
  }

  ties.sort((a, b) => new Date(a.sortAt) - new Date(b.sortAt));
  return ties;
}

(async () => {
  if (!KEY) { console.error('FOOTBALL_API_KEY missing'); process.exit(1); }

  const out = {};
  for (const comp of COMPS) {
    await sleep(400);
    let rows = [];
    try {
      rows = await api(`/fixtures?league=${comp.id}&season=${SEASON}`);
    } catch (e) {
      console.log(`  ✖ ${comp.name}: ${e.message}`);
      continue;
    }

    const byRound = new Map();
    for (const f of rows) {
      const r = f.league.round || '';
      if (!ORDER.some((o) => o.toLowerCase() === r.toLowerCase())) continue;   // المجموعات والتصفيات تُتخطّى
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r).push(f);
    }

    if (!byRound.size) { console.log(`  ${comp.name}: no knockout rounds yet`); continue; }

    const stages = [...byRound.entries()]
      .sort((a, b) => ORDER.findIndex((o) => o.toLowerCase() === a[0].toLowerCase())
                    - ORDER.findIndex((o) => o.toLowerCase() === b[0].toLowerCase()))
      .map(([round, list]) => ({ round, ties: toTies(list) }));

    // ─── الخيوط: كلّ مواجهة تُوصَل بالمواجهتين التي أنتجت فريقيها ───
    // هذا هو جوهر الملفّ: الربط بالفائز الفعليّ، فإن لم يُحسَم دور سابق يبقى
    // الخيط فارغًا بدل أن يُرسَم خطًّا كاذبًا.
    // ⚠️ «الدور السابق» ليس السابق في اللائحة: مباراة تحديد المركز الثالث تقع
    // بين نصف النهائي والنهائي، فلو اعتُبرت سابقةً للنهائي لبقي النهائي بلا
    // خيوط (وقع فعلًا). فالمسار الرئيسيّ يُحسَب بمعزل عنها، ومصدرها هو نصف النهائي.
    const main = stages.filter((s) => !/3rd place/i.test(s.round));
    const semis = stages.find((s) => /semi/i.test(s.round));
    const sourceOf = (stage) => {
      if (/3rd place/i.test(stage.round)) return semis && semis !== stage ? semis.ties : null;
      const i = main.indexOf(stage);
      return i > 0 ? main[i - 1].ties : null;
    };

    for (const stage of stages) {
      const prev = sourceOf(stage);
      if (!prev) continue;
      for (const tie of stage.ties) {
        tie.from = tie.teams.map((tm) => {
          // الفائز أوّلًا، ثمّ **الخاسر**: مباراة تحديد المركز الثالث تُلعَب بين
          // خاسرَي نصف النهائي، فربطها بالفائزين وحده يتركها بلا خيوط (وقع فعلًا:
          // 14 من 16 مواجهة موصولة، والناقصتان هما هذه).
          const asWinner = prev.find((p) => p.winnerId === tm.id);
          if (asWinner) return asWinner.key;
          const asLoser = prev.find((p) => p.winnerId && p.winnerId !== tm.id && p.teams.some((x) => x.id === tm.id));
          return asLoser ? asLoser.key : null;
        });
      }
    }


    out[comp.code] = { name: comp.name, leagueId: comp.id, season: SEASON, stages };
    const total = stages.reduce((n, s) => n + s.ties.length, 0);
    const linked = stages.slice(1).reduce((n, s) => n + s.ties.filter((t) => (t.from || []).some(Boolean)).length, 0);
    console.log(`  ${comp.name}: ${stages.length} stages · ${total} ties · linked ${linked}`);
  }

  console.log(`\nprovider calls: ${calls} · competitions with a bracket: ${Object.keys(out).length}`);
  if (!PUSH) { console.log('(dry run — add --push to send)'); return; }
  if (!WORKER || !TOKEN) { console.error('WORKER_URL or INGEST_TOKEN missing'); process.exit(1); }

  const res = await fetch(`${WORKER}/football/ingest-knockout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ generatedAt: new Date().toISOString(), brackets: out }),
  });
  console.log(`push → HTTP ${res.status} ${await res.text()}`);
  if (!res.ok) process.exit(1);
})().catch((e) => { console.error('push-knockout failed:', e.message || e); process.exit(1); });
