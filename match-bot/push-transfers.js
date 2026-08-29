/**
 * push-transfers.js — يجمع أحدث الانتقالات الحقيقيّة ويدفعها إلى سيرفرنا.
 *
 * ليش منفصل عن ساحب المباريات: الانتقالات تتغيّر ببطء، فتُجمَع **مرّة أو مرّتين
 * يوميًّا** لا كلّ خمس دقائق. خلطهما كان سيصرف نداءات بلا فائدة.
 *
 * ليش من هنا لا من داخل الـWorker: نفس السبب المقيس — المزوّد يرفض جزءًا من
 * نداءات عناوين Cloudflare، وينجح من GitHub Actions.
 *
 * الكلفة: نداء واحد لكلّ نادٍ (نداء يرجّع كلّ انتقالات النادي)، والقائمة تحت
 * محدودة بالأندية الكبيرة ⇒ ~20 نداء للجولة.
 *
 * التشغيل:
 *   node match-bot/push-transfers.js            جمع وطبع
 *   node match-bot/push-transfers.js --push     جمع ودفع
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const KEY = process.env.FOOTBALL_API_KEY;
const WORKER = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.INGEST_TOKEN;
const HOST = 'https://v3.football.api-sports.io';
const PUSH = process.argv.includes('--push');

/**
 * أندية المتابعة — أرقام المزوّد. مقصودة ومحدودة: الجمهور يتابع انتقالات هذه
 * الأندية، وكلّ نادٍ زائد = نداء زائد كلّ جولة.
 * (الأرقام تُستخرَج بـ`/teams?search=` مرّة واحدة، وهي ثابتة عند المزوّد.)
 */
const CLUBS = [
  { id: 541, name: 'Real Madrid' },
  { id: 529, name: 'Barcelona' },
  { id: 530, name: 'Atletico Madrid' },
  { id: 40, name: 'Liverpool' },
  { id: 50, name: 'Manchester City' },
  { id: 33, name: 'Manchester United' },
  { id: 42, name: 'Arsenal' },
  { id: 49, name: 'Chelsea' },
  { id: 47, name: 'Tottenham' },
  { id: 157, name: 'Bayern Munich' },
  { id: 165, name: 'Borussia Dortmund' },
  { id: 85, name: 'Paris Saint Germain' },
  { id: 496, name: 'Juventus' },
  { id: 505, name: 'Inter' },
  { id: 489, name: 'AC Milan' },
  { id: 492, name: 'Napoli' },
  { id: 2506, name: 'Al Nassr' },
  { id: 2932, name: 'Al Hilal' },
  { id: 2938, name: 'Al Ittihad' },
];

/** أحدث كم شهرًا يُعرَض. أقدم من ذلك ليس خبرًا. */
const MONTHS_BACK = 6;
const MAX_ITEMS = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

/**
 * أسماء المزوّد ليست نظيفة دائمًا، وهذان عيبان **مرئيّان فعلًا** في مخرَجه:
 *   «Yoram\t Zague»        ← الحرفان \ و t نصًّا داخل الاسم، لا مسافة جدوليّة
 *   «IfeanyiIfeanyi Ndukwe» ← الاسم الأوّل مضاعف
 * يُنظَّفان هنا لا في التطبيق: البيانات تُصلَح عند مصدرها مرّة واحدة، بدل أن
 * يحمل كلّ عارض حيلة تجميل.
 */
function cleanName(raw) {
  return String(raw || '')
    .replace(/\\[tnr]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => w.replace(/^(\p{L}{3,})\1$/u, '$1'))
    .join(' ')
    .trim();
}

async function api(path) {
  calls++;
  const res = await fetch(HOST + path, { headers: { 'x-apisports-key': KEY } });
  const body = await res.json();
  if (body.errors && !Array.isArray(body.errors) && Object.keys(body.errors).length) {
    throw new Error('provider: ' + JSON.stringify(body.errors));
  }
  return body.response || [];
}

(async () => {
  if (!KEY) { console.error('FOOTBALL_API_KEY missing'); process.exit(1); }

  const since = new Date(Date.now() - MONTHS_BACK * 30 * 86400000).toISOString().slice(0, 10);
  const seen = new Set();
  const items = [];

  for (const club of CLUBS) {
    await sleep(350);   // الدفعة السريعة مرفوضة عند المزوّد (مقيس)
    let rows = [];
    try {
      rows = await api(`/transfers?team=${club.id}`);
    } catch (e) {
      console.log(`  ✖ ${club.name}: ${e.message}`);
      continue;
    }

    let added = 0;
    for (const row of rows) {
      const player = row.player;
      if (!player) continue;
      for (const tr of row.transfers || []) {
        if (!tr.date || tr.date < since) continue;
        const out = tr.teams && tr.teams.out;
        const inn = tr.teams && tr.teams.in;
        if (!out || !inn) continue;
        // ⚠️ المفتاح **بلا تاريخ** بقصد: المزوّد يسجّل الانتقال الواحد أكثر من
        // مرّة بتواريخ متقاربة (ظهر «Sávio: مانشستر سيتي ← توتنهام» بتاريخين)،
        // فلو دخل التاريخ في المفتاح لظهر الخبر مرّتين في التطبيق.
        const key = `${player.id}|${out.id}|${inn.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          playerId: player.id,
          player: cleanName(player.name),
          date: tr.date,
          type: tr.type || null,
          from: { id: out.id, name: out.name, logo: out.logo },
          to: { id: inn.id, name: inn.name, logo: inn.logo },
        });
        added++;
      }
    }
    console.log(`  ${club.name}: +${added}`);
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  const top = items.slice(0, MAX_ITEMS);
  console.log(`\nprovider calls: ${calls} · unique transfers kept: ${top.length} (of ${items.length})`);
  if (top[0]) console.log(`  newest: ${top[0].date}  ${top[0].player}  ${top[0].from.name} → ${top[0].to.name}`);

  if (!PUSH) { console.log('(dry run — add --push to send)'); return; }
  if (!WORKER || !TOKEN) { console.error('WORKER_URL or INGEST_TOKEN missing'); process.exit(1); }

  const res = await fetch(`${WORKER}/football/ingest-transfers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ generatedAt: new Date().toISOString(), transfers: top }),
  });
  console.log(`push → HTTP ${res.status} ${await res.text()}`);
  if (!res.ok) process.exit(1);
})().catch((e) => { console.error('push-transfers failed:', e.message || e); process.exit(1); });
