/**
 * build-schedule.js
 * يبني جدول نشر لسنة كاملة بالاعتماد على الصور المصدّرة (output/manifest.json).
 * التوزيع: ٣ منشورات/أسبوع (اثنين + أربعاء + جمعة) + ستوري كل جمعة.
 * الجمعة = بوست تحميل (⑨/story). الأيّام الفاضية للفيديو = تنترك فاضية (type=VIDEO_SLOT) لتعبّيها لاحقًا.
 *
 * التشغيل:  npm run schedule -- [--start=YYYY-MM-DD] [--weeks=52]
 * النتيجة:  output/schedule.json  +  output/schedule.csv
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, 'output');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

// ===== قراءة الخيارات =====
const args = process.argv.slice(2);
function opt(name, def) {
  const a = args.find((x) => x.startsWith('--' + name + '='));
  return a ? a.split('=')[1] : def;
}
const START = opt('start', new Date().toISOString().slice(0, 10));
const WEEKS = parseInt(opt('weeks', '52'), 10);

// ===== أوقات النشر (٢٤ ساعة، بتوقيت جهازك) =====
const TIMES = { mon: '13:00', wed: '20:00', fri: '20:30', story: '11:00' };
const PLATFORMS_POST = ['facebook', 'instagram']; // مدموجين
const PLATFORMS_TT = ['facebook', 'instagram', 'tiktok'];

// ===== دورة ١٢ أسبوع: أي بوست ينزل كل يوم (بأرقام post-XX من الـmanifest) =====
// post-01=الإطلاق ... حسب ترتيب القوالب. story=ستوري التحميل.
const CYCLE = [
  // [الاثنين, الأربعاء, الجمعة]
  ['post-02', 'post-08', 'story'],
  ['post-07', 'post-05', 'post-15'],
  ['post-19', 'post-03', 'story'],
  ['post-14', 'post-06', 'post-11'],
  ['post-04', 'post-02', 'post-15'],
  ['post-23', 'post-17', 'story'],
  ['post-05', 'post-16', 'post-16'],
  ['post-07', 'post-03', 'post-15'],
  ['post-08', 'post-06', 'story'],
  ['post-14', 'post-12', 'post-18'],
  ['post-04', 'post-13', 'post-15'],
  ['post-23', 'post-10', 'story'],
];

// ===== الفيديوهات العضويّة (automation/videos/ads_1..10.mp4) — تدور على السنة =====
// خانة كل سبت تتعبّى بالفيديو التالي بالدور. ads_1 (الإطلاق) على أوّل سبت.
const VID_TAGS = '#TactIQ #FootballCoaching #كرة_قدم #تدريب_كرة_القدم';
const VIDEOS = [
  { file: 'ads_1.mp4',  ar: 'وصل TactIQ ⚽ منهج تدريب كامل بجيبتك: كورسات UEFA من C لـPRO، خطط تطوّر 365 يوم، تحليلات متحركة وأدوات مدرّب. حمّله مجّاناً 👇', en: 'TactIQ is here ⚽ a full coaching pathway in your pocket: UEFA courses C→PRO, 365-day plans, animated lessons & coach tools. Download free 👇' },
  { file: 'ads_2.mp4',  ar: 'رحلتك من C إلى PRO 🎓 اثنتان وخمسون وحدة، 621 سؤال، قفل تسلسليّ يضمن تتعلّم صح. عربيّ وإنجليزيّ، ويشتغل بلا إنترنت.', en: 'Your path from C to PRO 🎓 52 units, 621 questions, sequential unlocking. Arabic & English, works offline.' },
  { file: 'ads_3.mp4',  ar: 'ارسم خطّتك… وشغّلها 🎬 لوح تكتيك كامل + تحليلات متحركة تشرح الحركة والقرار خطوة بخطوة.', en: 'Draw your plan… then play it 🎬 a full tactics board + animated lessons, step by step.' },
  { file: 'ads_4.mp4',  ar: 'الفرق مش بالقدمين… بالعقل والقرار 🧠 الذكاء الكرويّ يصنع اللاعب المميّز. علّم لاعبيك يفكّروا.', en: "The difference isn't the feet — it's the mind 🧠 Football IQ makes the elite player." },
  { file: 'ads_5.mp4',  ar: 'كل أدواتك بمكان واحد 🧰 تقرير مباراة، تشكيلة ملعب، مخطّط أسبوعيّ، تحليل فيديو، ملفّات لاعبين، ومحرّر تمارين.', en: 'All your tools in one place 🧰 match reports, lineup pitch, weekly planner, video analysis, player profiles & a drill designer.' },
  { file: 'ads_6.mp4',  ar: 'كل الكرة بجيبتك ⚽ نتائج مباشرة، رزنامة، أخبار وانتقالات، ترتيب وهدّافين. تابع فرقك.', en: 'All of football in your pocket ⚽ live scores, calendar, news & transfers, tables & top scorers.' },
  { file: 'ads_7.mp4',  ar: 'شوف الحركة والقرار — خطوة بخطوة ▶️ دروس تكتيكيّة متحركة على ملعب حقيقيّ: ضغط، تغطية، تحوّلات.', en: 'See the movement & decision — step by step ▶️ animated tactical lessons: press, cover, transitions.' },
  { file: 'ads_8.mp4',  ar: '365 يوم من التطوّر 📅 تمرين يوميّ برسومات، مهمّة ملعب، وتأمّل يربط النظريّة بالتطبيق.', en: '365 days of growth 📅 a daily illustrated drill, a pitch task, and a reflection.' },
  { file: 'ads_9.mp4',  ar: 'قبل: حفظ عشوائيّ ❌ بعد: منهج UEFA مرتّب وخطّة يوميّة ✅ نظّم تدريبك مع TactIQ.', en: 'Before: random memorising ❌ After: a structured UEFA path & daily plan ✅' },
  { file: 'ads_10.mp4', ar: 'تحدّي تكتيكيّ 🧠 شو التشكيل الأفضل ضدّ 4-3-3؟ فكّر وجاوبنا بالتعليقات 👇', en: "Tactical challenge 🧠 what's the best shape against a 4-3-3? Answer below 👇" },
];

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('❌ ما لقيت output/manifest.json — شغّل أوّلاً: npm run export');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

// يرجّع بيانات صورة (عربي افتراضيًّا) حسب الاسم
function pick(manifest, name, lang) {
  return manifest.find((m) => m.name === name && m.lang === (lang || 'ar'));
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
// يرجّع أوّل اثنين >= تاريخ البداية
function firstMonday(startStr) {
  const d = new Date(startStr + 'T00:00:00');
  const day = d.getDay(); // 0=أحد .. 1=اثنين
  const diff = (day <= 1) ? (1 - day) : (8 - day);
  return addDays(startStr, diff);
}

function csvEscape(s) {
  s = (s == null ? '' : String(s)).replace(/"/g, '""');
  return '"' + s + '"';
}

(function main() {
  const manifest = loadManifest();
  const monday = firstMonday(START);
  const rows = [];

  for (let w = 0; w < WEEKS; w++) {
    const cyc = CYCLE[w % CYCLE.length];
    const weekMonday = addDays(monday, w * 7);
    const slots = [
      { day: 'mon', offset: 0, time: TIMES.mon, post: cyc[0] },
      { day: 'wed', offset: 2, time: TIMES.wed, post: cyc[1] },
      { day: 'fri', offset: 4, time: TIMES.fri, post: cyc[2] },
    ];

    for (const s of slots) {
      const date = addDays(weekMonday, s.offset);
      const isStory = s.post === 'story';
      const imgAr = pick(manifest, s.post, 'ar');
      const imgEn = pick(manifest, s.post, 'en');
      rows.push({
        date,
        time: s.time,
        platforms: PLATFORMS_POST,
        media_type: isStory ? 'STORY' : 'IMAGE',
        image_ar: (imgAr || {}).file || '',
        image_en: (imgEn || {}).file || '',
        caption_ar: imgAr ? imgAr.caption : '',
        caption_en: imgEn ? imgEn.caption : '',
        hashtags: imgAr ? imgAr.hashtags : '',
        week: w + 1,
        status: 'pending',
      });
    }

    // ستوري إضافيّة كل جمعة (تذكير بالصفحة) — نفس ستوري التحميل
    rows.push({
      date: addDays(weekMonday, 4),
      time: TIMES.story,
      platforms: PLATFORMS_POST,
      media_type: 'STORY',
      image_ar: (pick(manifest, 'story', 'ar') || {}).file || '',
      image_en: (pick(manifest, 'story', 'en') || {}).file || '',
      caption_ar: 'حمّل TactIQ الآن ⚽',
      caption_en: 'Download TactIQ now ⚽',
      hashtags: '#TactIQ',
      week: w + 1,
      status: 'pending',
    });

    // خانة فيديو (السبت) — تتعبّى تلقائيًّا بالفيديو التالي بالدور (ads_1..10)
    const vid = VIDEOS[w % VIDEOS.length];
    rows.push({
      date: addDays(weekMonday, 5),
      time: '19:00',
      platforms: ['facebook', 'instagram'], // تيك توك لاحقًا (يحتاج موافقة تطبيق)
      media_type: 'VIDEO',
      video: vid.file,
      image_ar: '',
      image_en: '',
      caption_ar: vid.ar,
      caption_en: vid.en,
      hashtags: VID_TAGS,
      week: w + 1,
      status: 'pending',
    });
  }

  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  fs.writeFileSync(path.join(OUT_DIR, 'schedule.json'), JSON.stringify(rows, null, 2), 'utf8');

  const header = ['date', 'time', 'platforms', 'media_type', 'video', 'image_ar', 'image_en', 'caption_ar', 'caption_en', 'hashtags', 'week', 'status'];
  const csv = [header.join(',')]
    .concat(rows.map((r) => header.map((h) => csvEscape(Array.isArray(r[h]) ? r[h].join('|') : r[h])).join(',')))
    .join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'schedule.csv'), '\uFEFF' + csv, 'utf8');

  const posts = rows.filter((r) => r.media_type === 'IMAGE' || r.media_type === 'STORY').length;
  const vids = rows.filter((r) => r.media_type === 'VIDEO').length;
  console.log(`🎉 جدول ${WEEKS} أسبوع جاهز — يبدأ الاثنين ${monday}`);
  console.log(`   ${posts} منشور/ستوري + ${vids} فيديو (ads_1..10 بالتدوير) — كلّها مجدولة.`);
  console.log(`   output/schedule.json  و  output/schedule.csv`);
})();
