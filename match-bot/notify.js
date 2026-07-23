/**
 * notify.js — عند حدث مباراة (هدف/بطاقة/نهاية)، يبني رسالة فيها:
 *   ① ملخّص الحدث  ② فكرة التصميم (عربي)  ③ برومت Gemini (إنجليزي جاهز)  ④ الكابشن الجاهز
 * ويبعتها على تيليغرام (لو مفاتيحه موجودة بـ .env)، وإلا بيطبعها بوضع معاينة.
 *
 * التشغيل:
 *   node notify.js                 # يستعمل sample-goal.json (معاينة)
 *   node notify.js my-event.json   # حدث تاني
 *   node notify.js --send          # يبعت فعليًّا على تيليغرام (بدّو مفاتيح .env)
 *
 * الفكرة: البوت يراقب المباراة (لاحقًا عبر API)، وبس يصير هدف بيبعتلك هالرسالة عالجوّال،
 * إنت بتاخد البرومت وبتولّد الصورة بـ Gemini Pro وبتنشرها مع الكابشن.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const SEND = process.argv.includes('--send');
const argFile = process.argv.find((a) => a.endsWith('.json'));
const eventFile = path.resolve(__dirname, argFile || 'sample-goal.json');

function codeToEmoji(code) {
  if (!code) return '';
  return String(code).toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// ===== ألوان أطقم المنتخبات (تقريبيّة — للبرومت) =====
const TEAM_COLORS = {
  fr: 'deep navy blue with white and red details', ma: 'red shirt with green details',
  es: 'vibrant red with navy shorts', ar: 'sky blue and white vertical stripes',
  br: 'bright yellow with green and blue', en: 'all white with navy details',
  pt: 'deep red with green details', de: 'white with black details',
  it: 'azure blue', nl: 'bright orange', be: 'red with black and yellow',
  hr: 'red and white checkerboard', eg: 'red with white and black',
  sa: 'white with green details', qa: 'dark maroon', us: 'white with navy and red',
};
const TEAM_NAMES_EN = {
  fr: 'France', ma: 'Morocco', es: 'Spain', ar: 'Argentina', br: 'Brazil', en: 'England',
  pt: 'Portugal', de: 'Germany', it: 'Italy', nl: 'Netherlands', be: 'Belgium', hr: 'Croatia',
  eg: 'Egypt', sa: 'Saudi Arabia', qa: 'Qatar', us: 'USA',
};
function kitDesc(ev) {
  if (ev.teamKit) return ev.teamKit;
  const national = /world cup|nations|euro|copa|كأس|أمم|international|قارّ/i.test(ev.competition || '');
  if (national) {
    const c = TEAM_COLORS[ev.teamCode];
    const nameEn = ev.teamEn || TEAM_NAMES_EN[ev.teamCode] || ev.team || 'national team';
    return `${nameEn} national team kit${c ? ' (' + c + ')' : ''}`;
  }
  return `${ev.team || 'the club'} club home kit`;
}
// اختيار متنوّع لكن ثابت حسب بذرة (نفس الحدث = نفس الستايل)
function seedFrom(ev) {
  const s = (ev.player || '') + (ev.min || '') + (ev.home ? ev.home.score : '') + (ev.away ? ev.away.score : '');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pick(arr, seed, salt) { return arr[(seed + (salt || 0)) % arr.length]; }

const STYLES = [
  'cinematic sports magazine cover photography', 'epic golden-hour cinematic photography',
  'bold high-contrast editorial photo poster', 'dramatic dark studio photography',
  'dynamic action sports photography with motion energy', 'premium moody cinematic poster',
];
// واقعيّة صارمة — تمنع الرسم/الكرتون/الأنمي
const REALISM = 'photorealistic, hyper-realistic cinematic photography, sharp DSLR quality, realistic skin textures and real fabric; strictly NOT cartoon, NOT anime, NOT comic, NOT illustration, NOT drawing, NOT painting, NOT 3D render';
const LIGHTS = [
  'dramatic golden and blue rim lighting', 'moody cinematic spotlight from above',
  'warm sunset backlight with lens flares', 'cold blue stadium floodlights with haze',
  'high-key bright celebratory lighting',
];
const COMPS = [
  'low-angle heroic shot, subject centered', 'subject slightly off-center with rule-of-thirds framing',
  'wide dynamic shot with stadium depth', 'tight dramatic close crop with motion energy',
];
// ===== مكتبة مفاهيم إبداعيّة مستوحاة من أسلوب 433 (سيناريوهات، مش نسخ) =====
// كل نصّ سيناريو عامّ بينطبق على أي لاعب. تجنّبنا علامات التنصيص داخل النصوص.
const CONCEPTS_GLORY = [ // أهداف حاسمة / إقصائيّات / نهائيات
  'reaching up toward a floating golden trophy wrapped in light rays, aspirational and epic',
  'standing at a mountain summit with a glowing trophy just ahead, one-step-away metaphor',
  'a giant hourglass with golden sand running out beside a hammer and cracked glass, race-against-time knockout mood',
  'pulling a glowing sword from a stone on a medieval battlefield with banners, chosen-one concept',
  'walking out of a dark tunnel into blinding golden light, destiny mood',
  'a golden trophy inside a glass display case while the player gazes at it with desire',
  'seated on an ornate throne surrounded by trophies in a hall of legends, king-of-the-game concept',
];
const CONCEPTS_LEGACY = [ // نجوم / أرقام قياسيّة / إنجازات
  'an epic career collage montage with a huge golden number and many blended past moments, tribute poster',
  'flipping through a football sticker album full of career highlights in a warm nostalgic room',
  'kneeling on a city pavement drawing a giant chalk number filled with past career scenes',
  'crouching beside a golden walk-of-fame star engraved with the player name',
  'wearing a royal crown and fur-trimmed robe on a throne, regal legend concept',
  'rendered as a bronze statue on a pedestal in a grand plaza, monument to greatness',
  'several versions of the same player from different eras sitting together on a vintage sofa, evolution concept',
];
const CONCEPTS_TRANSFER = [ // انتقالات
  'walking down a club corridor waving goodbye with the club crest on the wall',
  'seated inside a giant open bank vault beside a large release-clause sign, high-value transfer concept',
  'trying on a new team shirt in front of a mirror, fresh-signing reveal',
];
const CONCEPTS_PATRIOTIC = [ // أهداف المنتخبات
  'as a historic general on a rearing white horse with national flags and a dramatic sky, leader concept',
  'standing before a famous national landmark at night, patriotic hero mood',
  'as an armored knight holding the national flag on a misty battlefield',
];
const CONCEPTS_QUIRKY = [ // طريف / سينمائيّ متنوّع
  'beside a glowing retro arcade machine showing an achievement-unlocked screen, playful pixel-art vibe',
  'performing on a concert stage as a rock band frontman under bright lights',
  'standing by school lockers in a coming-of-age high-school hallway scene',
  'at a crime-scene investigation with evidence markers and tape, detective theme',
  'in a retro office cubicle with a vintage computer, workplace parody',
  'floating inside a spaceship cockpit above earth with a conquered-map screen',
  'as an adventurer archer perched on a jungle tree branch',
  'escaping underwater past circling sharks toward the surface, survival tension',
  'resting in a boxing ring corner with gloves, prizefighter concept',
  'as a jeweler inspecting a diamond-encrusted football under a lamp, craftsmanship concept',
  'in an artist studio calmly painting a nearly finished golden trophy on a canvas',
  'at a medieval round-table council of football stars in a stone hall',
];
const CONCEPTS_EMOTION = [ // طرد / خسارة / ضغط
  'sitting alone head down in a dim locker room under a faint chalk crown on the wall, bittersweet mood',
  'leaning against a rain-soaked brick wall beside a painted mural, moody cinematic street',
];
const CONCEPTS_ART = [ // لمسات فنّيّة واقعيّة (بلا رسم/كرتون)
  'a photographic double-exposure of the player profile blended with a roaring stadium and the national flag',
  'bold minimalist poster with the real player photo over a huge solid-color background and elegant negative space',
  'a dramatic studio portrait with strong rim lighting, smoke and premium magazine finish',
  'the player with glowing floating holographic tactical diagrams and light lines around him, football-genius concept',
];
const CONCEPTS_CELEBRATE = [ // احتفال (خيار واحد ضمن التنوّع، مش الغالب)
  'dynamic celebration in a packed stadium with confetti and blurred crowd',
];
const STAR_HINT = ['messi', 'ronaldo', 'mbappe', 'haaland', 'salah', 'neymar', 'bellingham', 'yamal', 'benzema', 'vinicius'];

function conceptFor(ev, seed) {
  const m = parseInt(ev.min, 10) || 0;
  const knockout = /final|semi|quarter|نهائي|نصف|ربع|knockout|round of 16|ثمن/i.test(ev.stage || '');
  const decisive = ev.type === 'winning_goal' || ev.type === 'final' || m >= 80;
  const star = STAR_HINT.some((s) => (ev.playerEn || ev.player || '').toLowerCase().includes(s));
  const national = /world cup|nations|euro|copa|كأس|أمم/i.test(ev.competition || '');

  let pool;
  if (ev.type === 'red_card') pool = CONCEPTS_EMOTION.concat(CONCEPTS_ART, CONCEPTS_QUIRKY);
  else if (ev.type === 'final') pool = CONCEPTS_GLORY.concat(CONCEPTS_LEGACY, CONCEPTS_CELEBRATE);
  else if (ev.type === 'transfer') pool = CONCEPTS_TRANSFER.slice();
  else if (ev.type === 'milestone' || ev.type === 'record') pool = CONCEPTS_LEGACY.concat(CONCEPTS_ART);
  else { // goal
    pool = CONCEPTS_QUIRKY.concat(CONCEPTS_ART);
    if (knockout && decisive) pool = CONCEPTS_GLORY.concat(pool);
    if (star) pool = CONCEPTS_LEGACY.concat(pool);
    if (national) pool = pool.concat(CONCEPTS_PATRIOTIC);
    pool = pool.concat(CONCEPTS_CELEBRATE);
  }
  return pool[seed % pool.length];
}
// قواعد النصّ (تمنع اللغات التانية والأرقام المخترعة)
function textRules(headline, name) {
  return `TEXT RULES: include ONLY a bold headline "${headline}" and the name "${name}", all text in ENGLISH only; do NOT add any minute, score, numbers, statistics, sponsor logos, tournament logos, or any other words or watermark`;
}
// مفاهيم «تذكير القمّة» — بوستر مواجهة قبل المباراة (فريقين)
const CONCEPTS_PREVIEW = [
  'two team captains face to face in an intense split poster, each side lit in its own team colors, VS matchup',
  'two rival players walking toward each other through a tunnel with both team flags painted on the walls',
  'a dramatic VS matchday poster with both crests and a floodlit stadium at night',
  'two players staring each other down over a glowing trophy at the center circle',
  'a gritty street-style duel between the two sides in a famous city at sunset',
];
// مفاهيم «الطريق للنهائي / التأهّل» — لتصاميم الفريق بعد فوز كبير
const CONCEPTS_ADVANCE = [
  'the national team squad walking down an airport jet-bridge boarding a plane, a boarding-pass-to-the-final concept',
  'a glowing highway road sign pointing toward the final city with a trophy shining at the end of the road',
  'the whole squad stepping through a giant doorway marked FINAL into blinding golden light',
  'the team raising the national flag on a mountain summit with a glowing trophy just ahead',
  'a giant golden ticket to the final stamped with the team crest, cinematic',
  'the team bus driving toward a glowing stadium in the final city skyline at night',
];

// وصف سياق المباراة والدقيقة (للتنوّع والدراما)
function narrative(ev) {
  const m = parseInt(ev.min, 10) || 0;
  const diff = ev.home && ev.away ? Math.abs(ev.home.score - ev.away.score) : 0;
  let n = [];
  if (m >= 85) n.push('a dramatic late goal');
  else if (m <= 10) n.push('an early opener');
  else n.push('a crucial goal');
  if (diff === 0) n.push('an equaliser that levels the tie');
  else if (diff === 1) n.push('a decisive go-ahead goal');
  if (/نهائي|final|semi/i.test(ev.stage || '')) n.push('in a high-stakes knockout match');
  return n.join(', ');
}

// ===== يبني الفكرة + البرومت + الكابشن حسب نوع الحدث =====
function build(ev) {
  const hf = codeToEmoji(ev.home.code), af = codeToEmoji(ev.away.code);
  const scoreLine = `${hf} ${ev.home.name} ${ev.home.score}-${ev.away.score} ${ev.away.name} ${af}`;
  const kit = kitDesc(ev);
  const player = ev.playerEn || ev.player || 'a footballer';
  const persona = ev.playerDesc ? `, ${ev.playerDesc}` : ''; // وصف/شخصيّة اللاعب لو متوفّرة
  const seed = seedFrom(ev);
  const style = pick(STYLES, seed, 1), light = pick(LIGHTS, seed, 2), scene = conceptFor(ev, seed);
  const brandColors = 'subtle brand accents of navy #0a1420, green #25C971 and amber #F0A23C';
  const surname = (ev.playerEn || ev.player || '').split(' ').slice(-1)[0];
  const plainKit = kit + ', plain shirt without sponsor or competition logos';

  let ideaAr, promptEn, captionAr, screen;

  if (ev.type === 'goal' || ev.type === 'winning_goal') {
    const m = parseInt(ev.min, 10) || 0;
    const winning = ev.type === 'winning_goal' || (m >= 85 && ev.home && ev.away && Math.abs(ev.home.score - ev.away.score) === 1);
    const headline = winning ? (m >= 85 ? 'WINNER' : 'GOLAZO') : 'GOAL';
    ideaAr = `${ev.player} سجّل${winning ? ' هدف حاسم' : ''} بالدقيقة ${ev.min}! ستايل متنوّع (${scene.split(',')[0]}). النصّ إنجليزيّ فقط: ${headline} + اسم اللاعب.`;
    promptEn = `${cap(style)}, ${scene}. Subject: ${player}${persona}, recognizable likeness, wearing ${plainKit}, ${narrative(ev)}. ${light}. ${brandColors}, leave clean empty space for text. ${textRules(headline, surname)}. Ultra sharp, high detail, 4:5 vertical.`;
    captionAr = `${scoreLine}\n${winning ? '⚡ هدف حاسم' : '⚽ هدف'} من ${ev.player} في الدقيقة ${ev.min}!\n🏆 ${ev.competition} — ${ev.stage}\n\nتابع التحليل التكتيكيّ على TactIQ ⚽\n#TactIQ #${(ev.team||'').replace(/\s/g,'_')} #كرة_قدم #Football`;
    screen = `${headline} — ${ev.player} ${ev.min}'  |  ${ev.home.score}-${ev.away.score}`;
  } else if (ev.type === 'red_card') {
    ideaAr = `بطاقة حمرا لـ${ev.player} بالدقيقة ${ev.min}. بوستر توتّر درامي متنوّع، بطاقة حمرا كبيرة عنصر رئيسيّ. النصّ إنجليزيّ فقط.`;
    promptEn = `${cap(style)}, ${scene}. Subject: ${player}${persona} in ${plainKit} reacting with frustration, moody dark red tone, ${light}, a large bold red card as a key graphic element. ${brandColors}, leave empty space for text. ${textRules('RED CARD', surname)}. Ultra sharp, 4:5 vertical.`;
    captionAr = `🟥 طرد!\n${scoreLine}\n${ev.player} تلقّى البطاقة الحمرا في الدقيقة ${ev.min}.\n🏆 ${ev.competition} — ${ev.stage}\n#TactIQ #${(ev.team||'').replace(/\s/g,'_')} #كرة_قدم`;
    screen = `RED CARD — ${ev.player} ${ev.min}'`;
  } else if (ev.type === 'preview') {
    const homeEn = ev.home.nameEn || ev.home.name;
    const awayEn = ev.away.nameEn || ev.away.name;
    const headline = ev.title || 'MATCHDAY';
    const pScene = pick(CONCEPTS_PREVIEW, seed);
    ideaAr = `تذكير قمّة: ${ev.home.name} ضدّ ${ev.away.name}. بوستر مواجهة (${pScene.split(',')[0]}). النصّ إنجليزيّ فقط.`;
    promptEn = `${cap(style)}, ${pScene}. A matchday hype poster for ${homeEn} versus ${awayEn}, using ONLY current-season players and current kits and crests (no retired or transferred players), epic tension. ${light}. ${brandColors}, leave clean empty space for text. ${textRules(headline, homeEn + ' vs ' + awayEn)}. Ultra sharp, high detail, 4:5 vertical.`;
    captionAr = `🔥 قمّة اليوم: ${ev.home.name} 🆚 ${ev.away.name}\n🏆 ${ev.competition}${ev.time ? '\n⏰ ' + ev.time : ''}\n\nمين بيفوز برأيك؟ 👇\nتابعوا التغطية على TactIQ ⚽\n#TactIQ #${(homeEn || '').replace(/\s/g, '_')} #${(awayEn || '').replace(/\s/g, '_')} #كرة_قدم`;
    screen = `${homeEn} vs ${awayEn}`;
  } else if (ev.type === 'advance' || ev.type === 'champion') {
    const teamEn = ev.teamEn || TEAM_NAMES_EN[ev.teamCode] || ev.team || 'the team';
    const champ = ev.type === 'champion';
    const headline = champ ? 'CHAMPIONS' : 'TO THE FINAL';
    const advScene = champ ? pick(CONCEPTS_GLORY, seed) : pick(CONCEPTS_ADVANCE, seed);
    const cityTxt = (ev.finalCity && !champ) ? ` on the road to ${ev.finalCity} for the final` : '';
    ideaAr = `${teamEn} ${champ ? 'أبطال!' : 'إلى النهائي!'} تصميم فريق فنّيّ (${advScene.split(',')[0]}). النصّ إنجليزيّ فقط.`;
    promptEn = `${cap(style)}, ${advScene}. The ${teamEn} national team squad using ONLY current-season players and current kits and crest (no retired or transferred players)${cityTxt}, cinematic epic celebration atmosphere. ${light}. ${brandColors}, leave clean empty space for text. ${textRules(headline, teamEn)}. Ultra sharp, high detail, 4:5 vertical.`;
    captionAr = `${champ ? '🏆' : '🎉'} ${teamEn} ${champ ? 'بطل ' + ev.competition + '!' : 'إلى نهائي ' + ev.competition + '!'}\n${scoreLine}${(ev.finalCity && !champ) ? `\n✈️ رحلة نحو ${ev.finalCity} للنهائي` : ''}\n\nتابعوا التغطية الكاملة على TactIQ ⚽\n#TactIQ #${(teamEn || '').replace(/\s/g, '_')} #كرة_قدم #Football`;
    screen = champ ? `CHAMPIONS — ${teamEn}` : `TO THE FINAL — ${teamEn}`;
  } else { // final (دوري أو تعادل — كرت نتيجة)
    const winner = ev.home.score === ev.away.score ? null : (ev.home.score > ev.away.score ? ev.home : ev.away);
    ideaAr = `انتهت المباراة ${scoreLine}. بوستر نتيجة نهائيّة أنيق متنوّع${winner ? ' مع أجواء احتفال ' + winner.name : ''}. النصّ إنجليزيّ فقط.`;
    promptEn = `${cap(style)}, ${scene}. ${winner ? 'Celebration atmosphere of the winning team ' + winner.name + '. ' : 'Post-match atmosphere. '}${player && player !== 'a footballer' ? 'Featuring ' + player + persona + ' in ' + plainKit + '. ' : ''}${light}. ${brandColors}, leave a large empty area for text. ${textRules('FULL TIME', (winner ? winner.name : ''))}. Ultra sharp, 4:5 vertical.`;
    captionAr = `⏱️ النهاية\n${scoreLine}\n🏆 ${ev.competition} — ${ev.stage}\n\nكل التفاصيل والتحليل على TactIQ ⚽\n#TactIQ #كرة_قدم #Football`;
    screen = `FULL TIME — ${ev.home.score}-${ev.away.score}`;
  }

  promptEn += ' ' + REALISM + '.';
  return { scoreLine, ideaAr, promptEn, captionAr, screen };
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function narrativeAr(ev) {
  const m = parseInt(ev.min, 10) || 0;
  if (m >= 85) return 'هدف في الوقت القاتل';
  if (m <= 10) return 'افتتاح مبكّر';
  return 'هدف مهمّ';
}

function formatMessage(ev, b) {
  return [
    `⚽ حدث جديد: ${ev.type.toUpperCase()}`,
    b.scoreLine,
    '',
    '🎨 فكرة التصميم:',
    b.ideaAr,
    '',
    '🔤 نصّ الشاشة المقترح:',
    b.screen,
    '',
    '📎 مهمّ قبل التوليد — ارفق بـGemini:',
    '   ١) صورة وجه اللاعب الحاليّة  ٢) صورة القميص الحاليّ',
    '   وقول: «استعمل نفس الوجه والقميص بالضبط من الصور المرفقة، لا تستعمل ذاكرتك».',
    '',
    '🤖 برومت Gemini (انسخه):',
    b.promptEn,
    '',
    '📝 الكابشن الجاهز (انسخه):',
    b.captionAr,
  ].join('\n');
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ناقصين بـ .env');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error('Telegram error: ' + JSON.stringify(j));
  return j.result.message_id;
}

module.exports = { build, formatMessage, sendTelegram, codeToEmoji };

// تشغيل مباشر (وضع تجربة على ملف حدث)
if (require.main === module) {
  (async () => {
    const ev = JSON.parse(fs.readFileSync(eventFile, 'utf8'));
    const b = build(ev);
    const msg = formatMessage(ev, b);

    console.log('\n================ رسالة التنبيه ================\n');
    console.log(msg);
    console.log('\n===============================================\n');

    if (SEND) {
      const id = await sendTelegram(msg);
      console.log('✅ انبعتت على تيليغرام (message id: ' + id + ')');
    } else {
      console.log('ℹ️ وضع معاينة. لبعثها فعليًّا على تيليغرام: node notify.js --send (بعد ضبط .env)');
    }
  })().catch((e) => { console.error('❌ خطأ:', e.message || e); process.exit(1); });
}
