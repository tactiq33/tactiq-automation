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
const { norm, leagueWeight, isBigCompetition, isBigClub, rivalryOf, isKnockout: koRound, isStarPlayer } = require('./rules');

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

function decide(ev) {
  const star = isStar(ev);

  // ===== تذكير القمّة قبل المباراة → تصميم مواجهة =====
  if (ev.type === 'preview') {
    return { action: 'aiDesign', reasons: ['تذكير قمّة اليوم'] };
  }

  // ===== نتائج المباريات الكبيرة (تأهّل / بطل) → تصميم فريق إبداعيّ =====
  if (ev.type === 'advance' || ev.type === 'champion') {
    return { action: 'aiDesign', reasons: [ev.type === 'champion' ? 'بطل بطولة كبرى' : 'تأهّل لمباراة كبيرة'] };
  }

  // ===== التصميم الإبداعيّ AI: لأكبر النجوم فقط =====
  if (['transfer', 'record', 'milestone'].includes(ev.type)) {
    return star
      ? { action: 'aiDesign', reasons: ['حدث خاصّ لنجم كبير: ' + ev.type] }
      : { action: 'resultCard', reasons: ['حدث ' + ev.type + ' (لاعب غير نجم) → كرت'] };
  }
  if (star && ['goal', 'assist', 'winning_goal'].includes(ev.type)) {
    return { action: 'aiDesign', reasons: ['نجم كبير: ' + (ev.playerEn || ev.player)] };
  }

  // ===== غير النجوم: كرت نتيجة للمباريات المهمّة، وإلا تخطّي =====
  const w = leaguePriority(ev);
  const involved = teamsInvolved(ev).map(norm);
  const alwaysCover = (RULES.alwaysCoverTeams || []).some((t) => involved.some((x) => x.includes(norm(t)) || norm(t).includes(x)));
  const bigMatch = (isBigComp(ev) && isKnockout(ev)) || isRivalry(ev) || isBigClash(ev);

  if (w > 0 || alwaysCover || bigMatch) {
    return { action: 'resultCard', reasons: ['مباراة مهمّة — كرت نتيجة (لاعب غير نجم)'] };
  }
  return { action: 'skip', reasons: ['حدث ثانويّ'] };
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
