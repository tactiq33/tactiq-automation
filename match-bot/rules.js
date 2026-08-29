/**
 * rules.js — طبقة القرار الوحيدة (أرقام البطولات لا أسماؤها)
 *
 * ⚠️ ليش وُجد هذا الملفّ — عطل حقيقيّ وصل للمالك
 * كان الوزن يُحسب بمطابقة **اسم** البطولة:
 *
 *     norm(league.name).includes(norm('Serie A'))
 *
 * ودوري البرازيل اسمه عند المزوّد حرفيًّا `Serie A`، فأخذ وزن دوري إيطاليا،
 * ووصل تنبيه عن مباراة برازيليّة. والقياس على لائحة المزوّد الكاملة:
 *
 *     257 بطولة من 1242 كانت تمرّ الفلتر القديم
 *     "Premier League" في 55 بطولة  ·  "Super Cup" في 59  ·  "Copa" في 58
 *     ومنها: Premier League/Lebanon · Ligue 1/Tunisia · Pro League/Trinidad
 *
 * ⇒ الأسماء لا تُستعمل للقرار أبدًا. الأرقام ثابتة عند المزوّد وفريدة لكلّ بطولة.
 * وكان المنطق مكرّرًا في `preview.js` و`live-ids.js` و`decide.js` بثلاث نسخ،
 * فصار تصليح واحد يترك اثنين مكسورين. من الآن: نسخة واحدة هنا.
 */
const fs = require('fs');
const path = require('path');

const RULES = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'content-rules.json'), 'utf8'));

const WEIGHTS = RULES.priorityLeagueIds || {};
const BIG_COMP_IDS = new Set((RULES.bigCompetitionIds || []).map(Number));

function norm(s) { return (s || '').toString().toLowerCase().trim(); }

/** يحوّل البطولة إلى رقمها، مهما كان شكل ما وصلنا (كائن، رقم، أو حدث). */
function leagueIdOf(league) {
  if (league == null) return null;
  if (typeof league === 'number') return league;
  if (typeof league === 'string') return /^\d+$/.test(league) ? Number(league) : null;
  if (league.id != null) return Number(league.id);
  if (league.leagueId != null) return Number(league.leagueId);
  return null;
}

/**
 * وزن البطولة من رقمها. أيّ بطولة غير مذكورة صراحةً ⇒ صفر، أي لا تنبيه.
 * القائمة البيضاء مقصودة: العالم فيه 1242 بطولة، ونحن نغطّي الكبرى وحدها.
 */
function leagueWeight(league) {
  const id = leagueIdOf(league);
  if (id == null) return 0;
  const w = WEIGHTS[String(id)];
  return typeof w === 'number' ? w : 0;
}

/** بطولة كبرى تُغطّى أدوارها الإقصائيّة (أبطال أوروبا، المونديال، أمم أوروبا...). */
function isBigCompetition(league) {
  const id = leagueIdOf(league);
  return id != null && BIG_COMP_IDS.has(id);
}

/**
 * نادٍ كبير — بمطابقة كلمة كاملة لا بجزء من الاسم.
 *
 * الشكل القديم `name.includes('inter')` كان يجعل `Internacional` البرازيليّ
 * ناديًا كبيرًا، و`Athletico` يلتبس بـ`Atletico`. الحدود تمنع ذلك:
 * «Inter» تطابق «Inter» و«Inter Milan»، ولا تطابق «Internacional».
 */
function isBigClub(name) {
  const n = norm(name);
  if (!n) return false;
  return (RULES.bigClubs || []).some((b) => {
    const t = norm(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + t + '($|[^a-z0-9])', 'i').test(n);
  });
}

/** ديربي/كلاسيكو: لازم الطرفان، وبنفس مطابقة الكلمة الكاملة. */
function rivalryOf(home, away) {
  const pair = (RULES.rivalries || []).find((p) => {
    const [x, y] = p;
    const hit = (team, name) => {
      const t = norm(team).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[^a-z0-9])' + t + '($|[^a-z0-9])', 'i').test(norm(name));
    };
    return (hit(x, home) && hit(y, away)) || (hit(y, home) && hit(x, away));
  });
  if (!pair) return null;
  const key = pair.map(norm).join('|');
  if (key.includes('real madrid') && key.includes('barcelona')) return 'EL CLASICO';
  return 'THE DERBY';
}

function isKnockout(round) {
  return (RULES.knockoutKeywords || []).some((k) => norm(round).includes(norm(k)));
}

/**
 * هل هذه «مباراة قويّة» تستحقّ تصميمًا؟
 *
 * قرار المالك: البرومبت للمهمّ فقط — نجوم مشهورون ومباريات قويّة. لاعب لا يعرفه
 * أحد في مباراة عاديّة **لا يُبعث عنه شيء أصلًا**. وكانت النسخة السابقة تبعث
 * رسالة نصّيّة «صار هدف وما منعمل تصميم»، وهي رسالة بلا فائدة: لا برومبت ولا صورة.
 *
 * يرجّع `null` إذا المباراة عاديّة، أو `{ title }` إذا قويّة (والعنوان يكون
 * EL CLASICO / THE DERBY إن وُجد، وإلّا `null` مع كون المباراة قويّة).
 */
function bigMatch({ league, home, away, round }) {
  const w = leagueWeight(league);
  if (w === 0) return null;                        // بطولة خارج القائمة ⇒ لا شيء

  const title = rivalryOf(home, away);
  const twoBig = isBigClub(home) && isBigClub(away);
  const bigKO = isBigCompetition(league) && isKnockout(round);
  const topLeagueWithBigClub = w >= 8 && (isBigClub(home) || isBigClub(away));

  if (title || twoBig || bigKO || topLeagueWithBigClub) return { title: title || null };
  return null;
}

/** نجم كبير — كلمة كاملة كذلك، فلا يمرّ «Ronaldo» داخل اسم آخر بالغلط. */
function isStarPlayer(name) {
  const n = norm(name);
  if (!n) return false;
  return (RULES.starPlayers || []).some((s) => {
    const t = norm(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + t + '($|[^a-z0-9])', 'i').test(n);
  });
}

module.exports = { RULES, norm, leagueIdOf, leagueWeight, isBigCompetition, isBigClub, rivalryOf, isKnockout, isStarPlayer, bigMatch };
