/**
 * find-fixture.js — يلاقي المباريات بتاريخ معيّن (وياخد رقمها fixture id).
 * التشغيل:  node find-fixture.js 2026-07-14 [كلمة بحث بالفريق]
 * مثال:     node find-fixture.js 2026-07-14 France
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const KEY = process.env.FOOTBALL_API_KEY;
const HOST = 'https://v3.football.api-sports.io';

async function api(path) {
  const res = await fetch(HOST + path, { headers: { 'x-apisports-key': KEY } });
  const j = await res.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors));
  return j;
}

(async () => {
  if (!KEY) { console.error('❌ FOOTBALL_API_KEY ناقص بـ .env'); process.exit(1); }
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const filter = (process.argv[3] || '').toLowerCase();

  const j = await api(`/fixtures?date=${date}`);
  let fx = j.response || [];
  if (filter) {
    fx = fx.filter((f) =>
      (f.teams.home.name + ' ' + f.teams.away.name).toLowerCase().includes(filter));
  }
  if (fx.length === 0) { console.log('⚠️ ما في مباريات مطابقة بهالتاريخ.'); return; }

  console.log(`\n📅 ${date} — ${fx.length} مباراة${filter ? ' (فلتر: ' + filter + ')' : ''}:\n`);
  fx.forEach((f) => {
    const t = new Date(f.fixture.date).toLocaleString();
    console.log(`  🆔 ${f.fixture.id}  |  ${f.teams.home.name} 🆚 ${f.teams.away.name}`);
    console.log(`      ${f.league.name} (${f.league.round})  —  ${t}  —  الحالة: ${f.fixture.status.short}\n`);
  });
  console.log('👉 خُذ الـ🆔 (fixture id) واستعملو بالمراقِب:  node watch.js --fixture=ID');
  console.log(`(الطلبات المستهلكة اليوم بعد هالنداء بتزيد ١)`);
})().catch((e) => { console.error('❌ خطأ:', e.message || e); process.exit(1); });
