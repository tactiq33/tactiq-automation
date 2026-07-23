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

function norm(s) { return (s || '').toString().toLowerCase(); }
function includesAny(hay, list) { const h = norm(hay); return list.some((x) => h.includes(norm(x))); }

function isStar(ev) {
  const p = norm(ev.playerEn || ev.player);
  return RULES.starPlayers.some((s) => p.includes(norm(s)));
}
function isKnockout(ev) { return includesAny(ev.stage, RULES.knockoutKeywords); }
function isBigComp(ev) {
  const c = norm(ev.competition);
  return ['champions league', 'world cup', 'كأس العالم', 'أبطال'].some((x) => c.includes(norm(x)));
}
function teamsInvolved(ev) {
  return [ev.home && ev.home.name, ev.away && ev.away.name, ev.team].filter(Boolean);
}
function isRivalry(ev) {
  const t = teamsInvolved(ev).map(norm);
  return RULES.rivalries.some((pair) => pair.every((team) => t.some((x) => x.includes(norm(team)) || norm(team).includes(x))));
}
function isBigClash(ev) {
  const names = [ev.home && ev.home.name, ev.away && ev.away.name].filter(Boolean);
  const bigCount = names.filter((n) => RULES.bigClubs.some((b) => norm(n).includes(norm(b)) || norm(b).includes(norm(n)))).length;
  return bigCount >= 2;
}
function leaguePriority(ev) {
  const c = ev.competition || '';
  for (const [name, w] of Object.entries(RULES.priorityLeagues)) {
    if (norm(c).includes(norm(name)) || norm(name).includes(norm(c))) return w;
  }
  return 0;
}

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
