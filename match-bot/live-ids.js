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

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith('--' + name));
  if (!a) return def;
  return a.includes('=') ? a.split('=')[1] : true;
}
const IDS_ONLY = !!arg('ids', false);
const MAX = parseInt(arg('max', '3'), 10);
const MIN_WEIGHT = parseFloat(arg('min', '2'));

// نفس طبقة القرار المستعملة في `preview.js` و`decide.js`.
const { isBigClub, rivalryOf, leagueWeight, isKnockout } = require('./rules');
const isRivalry = (h, a) => !!rivalryOf(h, a);
const { createClient, IS_FREE, stopGracefully, pausedOnFreePlan } = require('./provider');

(async () => {
  // ⚠️ الباقة المجّانيّة (100 نداء/يوم) ما بتساع المراقبة: جولة كلّ 10 دقائق = نداء
  // هون + نداءين لكلّ مباراة ⇒ ~300 نداء باليوم. فتنطفي بهدوء: لا أرقام على stdout،
  // فالـworkflow يقرأ «لا مباراة» ويكمّل بلا فشل.
  if (IS_FREE) {
    pausedOnFreePlan('live-ids', 'Live match watching needs ~300 calls/day; the free plan has 100. Set API_PLAN=paid after upgrading.');
    return;
  }

  const client = createClient({ label: 'live-ids', maxCalls: 1 });
  await client.preflight(1);
  const j = { response: await client.api('/fixtures?live=all') };
  const rows = (j.response || []).map((fx) => {
    const home = fx.teams.home.name;
    const away = fx.teams.away.name;
    const league = fx.league || {};
    const round = league.round || '';

    // الوزن: البطولة أساس (برقمها)، والنجوم والديربي والإقصائيّات تزيد.
    // ⚠️ وزن البطولة صفر ⇒ المباراة تُهمَل ولو كان فيها ديربي أو نادٍ كبير:
    // بلا هذا الشرط كانت الإضافات لحدها ترفع مباراة في دوري صغير فوق الحدّ.
    const base = leagueWeight(league);
    let weight = 0;
    if (base > 0) {
      weight = base;
      if (isBigClub(home)) weight += 1.5;
      if (isBigClub(away)) weight += 1.5;
      if (isRivalry(home, away)) weight += 3;
      if (isKnockout(round)) weight += 2;
    }

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
  // stdout يبقى فاضي بقصد: الـworkflow يستهلك الأرقام منه فقط.
  if (stopGracefully('live-ids', e)) return;
  console.error('live-ids failed:', e.message);
  process.exit(1);
});
