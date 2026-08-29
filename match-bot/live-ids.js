/**
 * live-ids.js — يرجّع أرقام المباريات **الحيّة الآن** اللي تستحقّ مراقبة،
 * حسب نفس قواعد content-rules.json (أندية كبيرة · ديربيات · دوريّات أولويّة · إقصائيّات).
 *
 * ليش وُجد: watch.js بدّه رقم مباراة، وما في شي يعطيه الأرقام تلقائيًّا.
 * كان لازم تلاقي الرقم بيدك عبر find-fixture.js وتشغّل المراقبة يدويًّا.
 * هذا الملفّ يسدّ هالثغرة فتصير الأتمتة ممكنة بلا تدخّل.
 *
 * التشغيل:
 *   node live-ids.js                 # معاينة مقروءة
 *   node live-ids.js --ids           # أرقام فقط، سطر لكلّ رقم (للـworkflow)
 *   node live-ids.js --max=3         # سقف عدد المباريات (افتراضيّ 3)
 *   node live-ids.js --min=2         # أدنى وزن للاستحقاق (افتراضيّ 2)
 *
 * ⚠️ نداء واحد فقط للـAPI (fixtures?live=all)، حتى تبقى الكلفة دقيقة ومعروفة.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const KEY = process.env.FOOTBALL_API_KEY;
const HOST = 'https://v3.football.api-sports.io';
const RULES = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'content-rules.json'), 'utf8'));

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith('--' + name));
  if (!a) return def;
  return a.includes('=') ? a.split('=')[1] : true;
}
const IDS_ONLY = !!arg('ids', false);
const MAX = parseInt(arg('max', '3'), 10);
const MIN_WEIGHT = parseFloat(arg('min', '2'));

function norm(s) { return (s || '').toString().toLowerCase(); }
function isBigClub(name) {
  return RULES.bigClubs.some((b) => norm(name).includes(norm(b)) || norm(b).includes(norm(name)));
}
function isRivalry(h, a) {
  return RULES.rivalries.some((p) => {
    const [x, y] = p.map(norm);
    return (norm(h).includes(x) && norm(a).includes(y)) || (norm(h).includes(y) && norm(a).includes(x));
  });
}
function leagueWeight(name) {
  for (const [n, w] of Object.entries(RULES.priorityLeagues)) {
    if (norm(name).includes(norm(n)) || norm(n).includes(norm(name))) return w;
  }
  return 0;
}
function isKnockout(round) {
  return RULES.knockoutKeywords.some((k) => norm(round).includes(norm(k)));
}

async function api(p) {
  const res = await fetch(HOST + p, { headers: { 'x-apisports-key': KEY } });
  const j = await res.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors));
  return j;
}

(async () => {
  if (!KEY) {
    console.error('FOOTBALL_API_KEY missing');
    process.exit(1);
  }

  const j = await api('/fixtures?live=all');
  const rows = (j.response || []).map((fx) => {
    const home = fx.teams.home.name;
    const away = fx.teams.away.name;
    const league = fx.league || {};
    const round = league.round || '';

    // الوزن: الدوري أساس، والنجوم والديربي والإقصائيّات تزيد
    let weight = leagueWeight(league.name);
    if (isBigClub(home)) weight += 1.5;
    if (isBigClub(away)) weight += 1.5;
    if (isRivalry(home, away)) weight += 3;
    if (isKnockout(round)) weight += 2;

    return {
      id: fx.fixture.id,
      minute: (fx.fixture.status && fx.fixture.status.elapsed) || 0,
      status: (fx.fixture.status && fx.fixture.status.short) || '',
      league: league.name || '',
      round,
      label: `${home} ${fx.goals.home}-${fx.goals.away} ${away}`,
      weight,
    };
  });

  const picked = rows
    .filter((r) => r.weight >= MIN_WEIGHT)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, Math.max(0, MAX));

  if (IDS_ONLY) {
    // مخرج نظيف للـworkflow: رقم لكلّ سطر، ولا شي غيره
    for (const r of picked) console.log(r.id);
    return;
  }

  console.log(`live fixtures: ${rows.length} · worth watching: ${picked.length} (min weight ${MIN_WEIGHT})`);
  for (const r of picked) {
    console.log(`  ${r.id}  w=${r.weight.toFixed(1)}  ${r.status} ${r.minute}'  ${r.league}  ${r.label}`);
  }
  if (!picked.length && rows.length) {
    console.log('  (لا شي يستحقّ — كلّها تحت حدّ الأولويّة)');
  }
})().catch((e) => {
  console.error('live-ids failed:', e.message);
  process.exit(1);
});
