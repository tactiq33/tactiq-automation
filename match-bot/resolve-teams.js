/**
 * يربط **أرقام الفرق التي يخزّنها التطبيق** بأرقامها عند مزوّد المباريات.
 *
 * ── ليش وُجد، ولماذا أُعيد بناؤه ────────────────────────────────────────
 * تنبيه الهدف يُرسَل إلى «موضوع» لكلّ فريق، والموضوع مبنيّ على رقم **api-sports**
 * لأنّه ما يظهر في بيانات المباراة (`home.id`).
 *
 * ⚠️ النسخة الأولى بنت الجدول من `lib/config.ts → CLUBS` (معرّفات نصّيّة مثل
 * `real_madrid`). وهذا كان **خطأً مقيسًا على جهاز المالك**: شاشة «اختياراتي»
 * (`app/preferences.tsx`) تجلب الفرق من **football-data** عبر `fetchTeams`
 * وتخزّن `t.id` الرقميّ تبعه. فكان المالك مختارًا ريال مدريد فعلًا، والتطبيق
 * يقول «اختر فرقك» لأنّ المفتاح لا يُطابق. ⇒ الجدول يجب أن يكون:
 *      football-data team id  →  api-sports team id
 * ولا يُبنى على لائحة لا تستعملها الشاشة.
 *
 * ودرس أعمّ: عند ربط معرّفات بين نظامين، يُقرأ **من حيث تُكتب القيمة فعلًا**، لا
 * من لائحة تبدو أنّها المصدر.
 *
 * التشغيل:
 *   node match-bot/resolve-teams.js            جرّب واعرض
 *   node match-bot/resolve-teams.js --write     اكتب TactIQ2/data/teamIds.json
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const KEY = process.env.FOOTBALL_API_KEY;                 // api-sports
const HOST = 'https://v3.football.api-sports.io';
const FD_BASE = 'https://api.football-data.org/v4';
const WRITE = process.argv.includes('--write');
// من مكان الملفّ لا من مجلّد التشغيل: المسار النسبيّ كان ينكسر إذا انشغّل من غير مجلّد.
const CONFIG = path.resolve(__dirname, '..', '..', 'TactIQ2', 'lib', 'config.ts');
const OUT = path.resolve(__dirname, '..', '..', 'TactIQ2', 'data', 'teamIds.json');

/** رمز الدوري في التطبيق ← رقم الدوري عند api-sports. */
const LEAGUE_ID = { PD: 140, PL: 39, SA: 135, BL1: 78, FL1: 61, DED: 88, PPL: 94, SPL: 307 };

/** علامات فرق الشباب والنسائيّة: أعطت أربعة أخطاء تبدو صحيحة في نسخة سابقة. */
const NOT_SENIOR = /\b(U\s?1[5-9]|U\s?2[0-3]|W|Women|Youth|Reserves?|Academy|II|B)\b/i;

/** أسماء تختلف بين المزوّدين اختلافًا لا تسدّه المطابقة. */
const ALIASES = {
  'Manchester United': ['Manchester Utd'],
  'Manchester City': ['Man City'],
  'Paris Saint Germain': ['Paris', 'PSG', 'Paris SG'],
  'Bayern München': ['Bayern Munich', 'Bayern'],
  'Borussia Dortmund': ['Dortmund', 'BVB'],
  'Internazionale': ['Inter'],
  'AC Milan': ['Milan'],
  'Atletico Madrid': ['Atlético Madrid', 'Atleti'],
  'Wolverhampton Wanderers': ['Wolves'],
  'Brighton & Hove Albion': ['Brighton Hove Albion', 'Brighton'],
  'Tottenham Hotspur': ['Tottenham'],
  'Newcastle United': ['Newcastle'],
  'Nottingham Forest': ['Nottingham'],
  'West Ham United': ['West Ham'],
  'Real Betis': ['Betis'],
  'Athletic Club': ['Athletic Bilbao'],
  'Celta Vigo': ['Celta de Vigo'],
  'Bayer Leverkusen': ['Bayer 04 Leverkusen'],
  'Borussia Monchengladbach': ['Borussia Mönchengladbach', 'Monchengladbach'],
  'Eintracht Frankfurt': ['Frankfurt'],
  'VfB Stuttgart': ['Stuttgart'],
  'FSV Mainz 05': ['Mainz 05', 'Mainz'],
  'Olympique Marseille': ['Marseille'],
  'Olympique Lyonnais': ['Lyon'],
  'Stade Rennais': ['Rennes'],
};

const strip = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (s) => strip(s).toLowerCase().replace(/\b(fc|cf|sc|ac|as|ss|ssc|afc|cd|rc|club|de|the)\b/g, '').replace(/[^a-z0-9]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fdToken() {
  const src = fs.readFileSync(CONFIG, 'utf8');
  const m = src.match(/FOOTBALL_DATA_TOKEN[^'"]*['"]([a-f0-9]{16,})['"]/i)
    || src.match(/['"]([a-f0-9]{32})['"]/);
  return process.env.EXPO_PUBLIC_FOOTBALL_DATA_TOKEN || (m && m[1]) || null;
}

// العميل الموحّد: نداء لكلّ دوري (8)، ووقوف هادئ عند رفض على مستوى الحساب.
// ⚠️ على المجّانيّ الموسم الحاليّ مرفوض («Free plans do not have access to this season»)،
// فهالأداة بتوقف بسبب واضح لحدّ ما يرجع المدفوع. الجدول الموجود بيضلّ كما هو.
const { createClient, ProviderStop, stopGracefully } = require('./provider');
const client = createClient({ label: 'resolve-teams', maxCalls: Object.keys(LEAGUE_ID).length });
const apiSports = (p) => client.api(p);

async function footballData(p, token) {
  const res = await fetch(FD_BASE + p, { headers: { 'X-Auth-Token': token } });
  if (!res.ok) throw new Error('football-data ' + res.status);
  return res.json();
}

function candidatesFor(name) {
  const out = [name];
  for (const [full, alts] of Object.entries(ALIASES)) {
    if (norm(full) === norm(name)) out.push(...alts);
    if (alts.some((a) => norm(a) === norm(name))) out.push(full, ...alts);
  }
  return [...new Set(out)];
}

function bestMatch(name, roster) {
  for (const cand of candidatesFor(name)) {
    const want = norm(cand);
    if (!want) continue;
    let best = null;
    for (const r of roster) {
      if (NOT_SENIOR.test(r.team.name)) continue;
      const got = norm(r.team.name);
      let score = 0;
      if (got === want) score = 100;
      else if (got.startsWith(want) || want.startsWith(got)) score = 70;
      else if (got.includes(want) || want.includes(got)) score = 55;
      if (score && (!best || score > best.score)) best = { score, team: r.team };
    }
    if (best && best.score >= 55) return best;
  }
  return null;
}

(async () => {
  await client.preflight(Object.keys(LEAGUE_ID).length);
  const token = fdToken();
  if (!token) { console.error('football-data token not found (lib/config.ts / EXPO_PUBLIC_FOOTBALL_DATA_TOKEN)'); process.exit(1); }

  const now = new Date();
  const season = now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  console.log('season: ' + season + '\n');

  const map = {};
  const unresolved = [];
  let fdTotal = 0;

  for (const [code, leagueId] of Object.entries(LEAGUE_ID)) {
    let roster = [];
    try {
      roster = await apiSports(`/teams?league=${leagueId}&season=${season}`);
    } catch (e) {
      if (e instanceof ProviderStop) throw e;   // ما في داعي نكمّل: كلّ الدوريّات رح ترجع نفس الرفض
      console.log(`  ${code}: api-sports roster failed — ${e.message}`);
      continue;
    }

    let fd;
    try {
      // football-data المجّانيّ: عشرة نداءات بالدقيقة ⇒ فاصل سبع ثوانٍ.
      await sleep(7000);
      fd = await footballData(`/competitions/${code}/teams`, token);
    } catch (e) {
      console.log(`  ${code}: football-data failed — ${e.message}`);
      continue;
    }

    const teams = fd.teams || [];
    fdTotal += teams.length;
    let ok = 0;
    for (const t of teams) {
      const name = t.shortName || t.name || '';
      const hit = bestMatch(name, roster) || bestMatch(t.name || '', roster);
      if (!hit) { unresolved.push(`${code} ${t.id} ${name}`); continue; }
      map[String(t.id)] = { apiId: hit.team.id, name, providerName: hit.team.name, league: code };
      ok++;
    }
    console.log(`  ${code}: ${ok}/${teams.length} matched  (api-sports roster ${roster.length})`);
  }

  console.log(`\nmapped ${Object.keys(map).length} of ${fdTotal} football-data teams`);
  if (unresolved.length) {
    console.log('unresolved (' + unresolved.length + '):');
    unresolved.slice(0, 25).forEach((u) => console.log('   ' + u));
  }

  // فحص عيّنة معروفة: لو انكسر الربط، هذه أوّل ما تكشفه.
  const CHECK = { '86': 'Real Madrid', '81': 'Barcelona', '66': 'Manchester United', '5': 'Bayern' };
  console.log('\nspot checks:');
  for (const [fdId, label] of Object.entries(CHECK)) {
    const e = map[fdId];
    console.log(`   fd ${fdId.padEnd(4)} ${label.padEnd(18)} → ` + (e ? `${e.apiId}  ${e.providerName}` : 'MISSING'));
  }

  if (!WRITE) { console.log('\n(dry run — add --write to save)'); return; }
  fs.writeFileSync(OUT, JSON.stringify({
    note: 'football-data team id (what app/preferences.tsx stores) -> api-sports team id. Used for goal-alert topics (team_<apiId>_<lang>).',
    generated: new Date().toISOString().slice(0, 10),
    season,
    teams: map,
  }, null, 2) + '\n');
  console.log('written: ' + OUT);
})().catch((e) => { if (stopGracefully('resolve-teams', e)) return; console.error('failed: ' + (e.message || e)); process.exit(1); });
