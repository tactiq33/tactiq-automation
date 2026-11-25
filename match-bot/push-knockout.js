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

/**
 * ── المصدر ──────────────────────────────────────────────────────────────
 * على الباقة المجّانيّة: football-data.org. السبب مقيس من سجلّ GitHub (2026-11-25):
 * API-Football المجّانيّ رجّع لكلّ البطولات التسعة
 *     "Free plans do not have access to this season, try from 2022 to 2024."
 * فالسكربت كان يدفع **شجرة فاضية** ويمسح ما في التطبيق. football-data المجّانيّ
 * يعطي الموسم الحاليّ (مونديال 2026: 104 مباريات بأدوارها) وبلا سقف يوميّ.
 * يغطّي ثلاث بطولات من التسعة: المونديال · أبطال أوروبا · أمم أوروبا. الباقي
 * يرجع لمّا يرجع المدفوع (API_PLAN=paid).
 */
const { createClient, IS_FREE, ProviderStop, stopGracefully } = require('./provider');
const FD = require('./football-data');

/** رمز البطولة في التطبيق ← رمزها عند football-data. */
const FD_CODE = { WC: 'WC', CL: 'CL', EURO: 'EC' };

const client = createClient({ label: 'push-knockout', maxCalls: COMPS.length });

/** مباريات البطولة بشكل API-Football، ومعها الموسم. */
async function loadRows(comp) {
  if (IS_FREE) {
    const code = FD_CODE[comp.code];
    if (!code) return null;   // خارج تغطية football-data المجّانيّة
    const body = await FD.fd(`/competitions/${code}/matches`);
    const ms = body.matches || [];
    const start = ms[0] && ms[0].season && ms[0].season.startDate;
    const season = (body.filters && Number(body.filters.season)) || (start ? Number(start.slice(0, 4)) : SEASON);
    return { rows: ms.map(FD.toFixture), season };
  }
  return { rows: await client.api(`/fixtures?league=${comp.id}&season=${SEASON}`), season: SEASON };
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
  if (IS_FREE) console.log('source: football-data.org (free plan — 0 API-Football calls)');
  else await client.preflight(COMPS.length);

  const out = {};
  let fetchedOk = 0;
  for (const comp of COMPS) {
    let rows = [];
    let season = SEASON;
    try {
      const got = await loadRows(comp);
      if (!got) { console.log(`  · ${comp.name}: not on the free source — skipped`); continue; }
      rows = got.rows;
      season = got.season;
      fetchedOk++;
    } catch (e) {
      if (e instanceof ProviderStop) throw e;   // حساب موقوف/حصّة/باقة: وقوف بلا دفع
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


    out[comp.code] = { name: comp.name, leagueId: comp.id, season, stages };
    const total = stages.reduce((n, s) => n + s.ties.length, 0);
    const linked = stages.slice(1).reduce((n, s) => n + s.ties.filter((t) => (t.from || []).some(Boolean)).length, 0);
    console.log(`  ${comp.name}: ${stages.length} stages · ${total} ties · linked ${linked}`);
  }

  // البطولات اللي ما انبنت هالجولة (فشل نداء، أو خارج المصدر المجّانيّ) تبقى بنسختها
  // الموجودة على السيرفر، بدل ما يمسحها الدفع.
  if (WORKER && Object.keys(out).length) {
    for (const comp of COMPS) {
      if (out[comp.code]) continue;
      try {
        const r = await fetch(`${WORKER}/football/knockout?comp=${comp.code}`);
        const b = r.ok ? await r.json() : null;
        if (b && Array.isArray(b.stages) && b.stages.length) {
          out[comp.code] = { name: b.name || comp.name, leagueId: b.leagueId || comp.id, season: b.season, stages: b.stages };
          console.log(`  ↺ ${comp.name}: kept the server copy`);
        }
      } catch {}
    }
  }

  console.log(`\nAPI-Football calls: ${client.calls} · football-data calls: ${FD.calls} · competitions with a bracket: ${Object.keys(out).length}`);
  // شجرة فاضية ما تندفع أبدًا: كانت تمسح ما في التطبيق (عطل 2026-11-25).
  if (!fetchedOk || !Object.keys(out).length) {
    console.log('nothing to push — the server copy is left untouched.');
    return;
  }
  if (process.argv.includes('--show')) {
    for (const [code, b] of Object.entries(out)) {
      for (const s of b.stages) {
        const line = s.ties.map((t) => {
          const w = t.teams.find((x) => x.id === t.winnerId);
          return `${t.teams[0].name} ${t.aggregate ? t.aggregate.join('-') : '?'} ${t.teams[1].name}${w ? ' →' + w.name : ''}`;
        });
        console.log(`  [${code}] ${s.round}: ${line.slice(0, 4).join(' · ')}${line.length > 4 ? ' …' : ''}`);
      }
    }
  }
  if (!PUSH) { console.log('(dry run — add --push to send)'); return; }
  if (!WORKER || !TOKEN) { console.error('WORKER_URL or INGEST_TOKEN missing'); process.exit(1); }

  const res = await fetch(`${WORKER}/football/ingest-knockout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ generatedAt: new Date().toISOString(), brackets: out }),
  });
  console.log(`push → HTTP ${res.status} ${await res.text()}`);
  if (!res.ok) process.exit(1);
})().catch((e) => {
  if (stopGracefully('push-knockout', e)) return;
  console.error('push-knockout failed:', e.message || e);
  process.exit(1);
});
