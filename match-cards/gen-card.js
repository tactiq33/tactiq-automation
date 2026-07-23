/**
 * gen-card.js — يولّد كرت نتيجة مباراة (PNG) + كابشن تلقائيّ من ملف بيانات JSON.
 *
 * التشغيل:
 *   node gen-card.js                       # يستعمل sample-match.json
 *   node gen-card.js my-match.json         # ملف بيانات تاني
 *
 * لاحقًا: بدل ملف JSON يدويّ، بيتعبّى تلقائيًّا من API كرة قدم (شوف README).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE = 'file://' + path.resolve(__dirname, 'match-card.html').replace(/\\/g, '/');
const dataFile = path.resolve(__dirname, process.argv[2] || 'sample-match.json');
const OUT_DIR = path.resolve(__dirname, 'output');

function codeToEmoji(code) {
  if (!code) return '';
  return String(code).toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
function autoCaption(m) {
  const g = (arr) => (arr || []).filter((e) => e.type === 'goal');
  const line = (e) => `${e.name} (${e.min}')`;
  const homeG = g(m.events.home).map(line).join('، ');
  const awayG = g(m.events.away).map(line).join('، ');
  const hf = codeToEmoji(m.home.code), af = codeToEmoji(m.away.code);
  let cap = `${hf} ${m.home.name} ${m.home.score}-${m.away.score} ${m.away.name} ${af}\n`;
  cap += `🏆 ${m.competition} — ${m.stage}\n`;
  if (homeG) cap += `⚽ ${m.home.name}: ${homeG}\n`;
  if (awayG) cap += `⚽ ${m.away.name}: ${awayG}\n`;
  if (m.motm) cap += `🏅 رجل المباراة: ${m.motm}\n`;
  cap += `\nتابع كل التحليلات التكتيكيّة على TactIQ ⚽\n#TactIQ #كرة_قدم #${m.home.name} #${m.away.name} #Football`;
  return cap;
}

(async () => {
  if (!fs.existsSync(dataFile)) { console.error('❌ ما لقيت ملف البيانات:', dataFile); process.exit(1); }
  const match = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 1400, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((m) => { window.MATCH_OVERRIDE = m; }, match);
  await page.goto(TEMPLATE, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await new Promise((r) => setTimeout(r, 600));

  const base = `${match.home.name}-${match.away.name}`.replace(/\s+/g, '_');
  const imgPath = path.join(OUT_DIR, base + '.png');
  const card = await page.$('#card');
  await card.screenshot({ path: imgPath });
  await browser.close();

  const caption = autoCaption(match);
  fs.writeFileSync(path.join(OUT_DIR, base + '.txt'), caption, 'utf8');

  console.log('✅ الكرت:', imgPath);
  console.log('✅ الكابشن:', path.join(OUT_DIR, base + '.txt'));
  console.log('\n--- الكابشن ---\n' + caption);
})().catch((e) => { console.error('❌ خطأ:', e); process.exit(1); });
