/**
 * resolve-players.js — يربط لاعبي التطبيق بأرقامهم عند المزوّد، **مرّة واحدة**.
 *
 * ليش: قائمة المتابعة في التطبيق (`TactIQ2/data/players.json`) معرّفاتها نصّيّة
 * من عندنا («ronaldo»)، فلا صورة لها. أرشيف المزوّد يعطي صورة لكلّ لاعب برابط
 * مباشر مبنيّ على **رقمه**:
 *
 *     https://media.api-sports.io/football/players/<id>.png
 *
 * فبمجرّد إضافة `apiId` للملفّ تصير الصور متاحة في كلّ الشاشات بلا أيّ نداء
 * وقت التشغيل وبلا استهلاك حصّة.
 *
 * التشغيل:  node match-bot/resolve-players.js [--write]
 * بلا `--write` يطبع فقط ولا يلمس الملفّ.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const KEY = process.env.FOOTBALL_API_KEY;
const HOST = 'https://v3.football.api-sports.io';
const WRITE = process.argv.includes('--write');
const FILE = path.resolve(__dirname, '..', '..', 'TactIQ2', 'data', 'players.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// نداء لكلّ لاعب بلا رقم ⇒ على المجّانيّ سقف للتشغيلة (--max=N، افتراضيّ 40) ويكمّل
// الباقي بتشغيلة تانية (اللي انربطوا ما بيتسألوا مرّة تانية).
const { createClient, IS_FREE, ProviderStop, stopGracefully } = require('./provider');
const maxArg = (process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1];
const MAX = Number(maxArg || (IS_FREE ? 40 : 500));
const client = createClient({ label: 'resolve-players', maxCalls: MAX });
const api = (p) => client.api(p);

/**
 * البحث يرجّع مئات النتائج لاسم شائع، فالاختيار **ليس أوّل نتيجة**:
 * تُفضَّل المطابقة التي يظهر فيها الاسم الكامل، ثمّ التي يطابق فيها اسم العائلة.
 */
function pick(rows, fullName) {
  const full = norm(fullName);
  const last = norm(fullName.split(' ').slice(-1)[0]);
  const cands = rows.map((r) => r.player).filter(Boolean);

  const exact = cands.find((p) => norm(p.name) === full || norm(`${p.firstname} ${p.lastname}`) === full);
  if (exact) return exact;

  const byLast = cands.filter((p) => norm(p.lastname || '') === last || norm(p.name).endsWith(last));
  // الأشهر عادةً الأقدم في القائمة بعد ترتيب المزوّد، ومن له صورة أرجح أن يكون معروفًا.
  return byLast.find((p) => !!p.photo) || byLast[0] || cands[0] || null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const list = data.players || [];
  console.log(`players in app catalogue: ${list.length}`);
  const todo = list.filter((p) => !p.apiId).length;
  if (!todo) { console.log('every player already has an apiId — nothing to ask the provider.'); return; }
  await client.preflight(Math.min(todo, MAX));

  let resolved = 0, kept = 0, failed = 0;
  for (const p of list) {
    if (p.apiId) { kept++; continue; }
    // ⚠️ المزوّد يرفض البحث بحروف غير لاتينيّة بسيطة، ويرفض أقلّ من أربعة أحرف.
    // فُشِلت أربعة أسماء بسبب ذلك: Mbappé · Vinícius · Modrić · Neymar Jr.
    // الحلّ: تُجرَّد الشدّات، ويُختار أطول كلمة صالحة (وليس آخر كلمة).
    const words = norm(p.name_en).replace(/[^a-z\s]/g, '').split(/\s+/).filter((w) => w.length >= 4);
    const term = words.sort((a, b) => b.length - a.length)[0];
    if (!term) { failed++; console.log(`  ✖ ${p.name_en}: no searchable word`); continue; }
    if (client.calls >= MAX) { console.log(`  … per-run cap of ${MAX} reached — run again to continue`); break; }
    try {
      const rows = await api(`/players/profiles?search=${encodeURIComponent(term)}`);   // التباعد داخل العميل
      const hit = pick(rows, p.name_en);
      if (hit) {
        p.apiId = hit.id;
        resolved++;
        console.log(`  ✔ ${p.name_en}  →  ${hit.id}  ${hit.name}`);
      } else {
        failed++;
        console.log(`  ✖ ${p.name_en}: no match`);
      }
    } catch (e) {
      if (e instanceof ProviderStop) { console.log(`  ■ stopped: ${e.message}`); break; }   // اللي انربط بينحفظ
      failed++;
      console.log(`  ✖ ${p.name_en}: ${e.message}`);
    }
  }

  console.log(`\nresolved ${resolved} · already had id ${kept} · failed ${failed}`);
  if (!WRITE) { console.log('(dry run — add --write to save)'); return; }

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log('written:', FILE);
})().catch((e) => { if (stopGracefully('resolve-players', e)) return; console.error('failed:', e.message || e); process.exit(1); });
