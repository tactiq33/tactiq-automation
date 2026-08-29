/**
 * decide.js — محرّك القرار: بياخد حدث ويقرّر شو نعمل فيه حسب content-rules.json
 *   → 'aiDesign'  (بوستر Gemini للأحداث الكبيرة)
 *   → 'resultCard' (كرت قالب للنتائج المهمّة)
 *   → 'skip'      (ثانويّ — مجمّع نتائج أو تخطّي)
 *
 * التشغيل:  node decide.js [event.json]
 * بينستعمل من المراقِب (watcher) لاحقًا ليقرّر تلقائيًّا.
 */
const fs = require('fs');
const path = require('path');

const RULES = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'content-rules.json'), 'utf8'));

// طبقة القرار المشتركة: أرقام البطولات، ومطابقة كلمة كاملة للأندية واللاعبين.
const { norm, leagueWeight, isBigCompetition, isBigClub, rivalryOf, isKnockout: koRound, isStarPlayer, bigMatch } = require('./rules');

function isStar(ev) { return isStarPlayer(ev.playerEn || ev.player); }
function isKnockout(ev) { return koRound(ev.stage); }

/** رقم بطولة الحدث. `watch.js` و`preview.js` يضعانه في كلّ حدث. */
function leagueOf(ev) { return ev.leagueId != null ? ev.leagueId : (ev.league && ev.league.id); }

function isBigComp(ev) { return isBigCompetition(leagueOf(ev)); }
function teamsInvolved(ev) {
  return [ev.home && ev.home.name, ev.away && ev.away.name, ev.team].filter(Boolean);
}
function isRivalry(ev) {
  return !!rivalryOf(ev.home && ev.home.name, ev.away && ev.away.name);
}
function isBigClash(ev) {
  const names = [ev.home && ev.home.name, ev.away && ev.away.name].filter(Boolean);
  return names.filter(isBigClub).length >= 2;
}
function leaguePriority(ev) { return leagueWeight(leagueOf(ev)); }

/** المباراة قويّة؟ (ديربي · ناديان كبيران · إقصائيّات بطولة كبرى · دوري كبير مع نادٍ كبير) */
function strongMatch(ev) {
  return bigMatch({
    league: leagueOf(ev),
    home: ev.home && ev.home.name,
    away: ev.away && ev.away.name,
    round: ev.stage,
  });
}

/**
 * القرار.
 *
 * ⚠️ قاعدة المالك الصريحة: **البرومبت للمهمّ فقط** — لاعب مشهور أو مباراة قويّة.
 * وأيّ حدث لا يستحقّ برومبتًا **لا تُبعث عنه رسالة إطلاقًا**.
 *
 * الحالة السابقة كانت تبعث نصًّا للأحداث الثانويّة («صار هدف، وما منعمل تصميم»)،
 * فوصلت للمالك ثلاث رسائل عن أهداف لاعبين لا يعرفهم أحد، بلا برومبت وبلا صورة.
 * هذا هو المسار الذي أُلغي: لم يبقَ `resultCard` مخرَجًا للقرار.
 */
function decide(ev) {
  const star = isStar(ev);
  const strong = strongMatch(ev);
  const involved = teamsInvolved(ev).map(norm);
  const alwaysCover = (RULES.alwaysCoverTeams || []).some((t) => involved.some((x) => x.includes(norm(t)) || norm(t).includes(x)));

  // ===== تذكير القمّة قبل المباراة (يُرشَّح أصلًا في preview.js) =====
  if (ev.type === 'preview') {
    return { action: 'aiDesign', reasons: ['تذكير قمّة اليوم'] };
  }

  // ===== تأهّل / بطل — بطولة كبرى بالتعريف =====
  if (ev.type === 'advance' || ev.type === 'champion') {
    return { action: 'aiDesign', reasons: [ev.type === 'champion' ? 'بطل بطولة كبرى' : 'تأهّل لمباراة كبيرة'] };
  }

  // ===== انتقال / رقم قياسيّ / إنجاز — للنجوم فقط =====
  if (['transfer', 'record', 'milestone'].includes(ev.type)) {
    return star
      ? { action: 'aiDesign', reasons: ['حدث خاصّ لنجم كبير: ' + ev.type] }
      : { action: 'skip', reasons: ['حدث ' + ev.type + ' لغير نجم — لا يستحقّ تصميمًا'] };
  }

  // ===== نجم سجّل أو صنع =====
  if (star && ['goal', 'assist', 'winning_goal'].includes(ev.type)) {
    return { action: 'aiDesign', reasons: ['نجم كبير: ' + (ev.playerEn || ev.player)] };
  }

  // ===== غير النجوم: يُقبل فقط داخل مباراة قويّة =====
  if (strong || alwaysCover) {
    const label = strong && strong.title ? strong.title : 'مباراة قويّة';
    if (['goal', 'winning_goal', 'assist'].includes(ev.type)) {
      return { action: 'aiDesign', reasons: ['هدف في ' + label] };
    }
    if (ev.type === 'red_card') {
      return { action: 'aiDesign', reasons: ['طرد في ' + label] };
    }
    if (ev.type === 'final') {
      return { action: 'aiDesign', reasons: ['نتيجة ' + label] };
    }
  }

  // ===== كلّ ما عدا ذلك: سكوت تامّ =====
  return { action: 'skip', reasons: ['حدث عاديّ — لا برومبت ولا رسالة'] };
}

module.exports = { decide };

// تشغيل مباشر للتجربة
if (require.main === module) {
  const f = process.argv[2] || 'sample-goal.json';
  const ev = JSON.parse(fs.readFileSync(path.resolve(__dirname, f), 'utf8'));
  const d = decide(ev);
  const label = { aiDesign: '🅰️ تصميم AI (بوستر Gemini)', resultCard: '🅱️ كرت نتيجة (قالب)', skip: '🅲️ تخطّي/مجمّع' };
  console.log('\nالحدث:', (ev.playerEn || ev.player || ''), '—', ev.competition, '(' + ev.stage + ')');
  console.log('القرار:', label[d.action]);
  console.log('السبب:', d.reasons.join(' • '));
}
