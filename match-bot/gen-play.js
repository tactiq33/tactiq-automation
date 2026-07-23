/**
 * gen-play.js — يولّد «خريطة الهدف» التكتيكيّة (PNG) من ملف play JSON.
 * التشغيل:  node gen-play.js [play.json]
 * البيانات شبه-يدويّة (إنت بتحدّد المواقع والأسهم والشروحات) لأنّ الـAPI ما بيعطي إحداثيّات.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE = 'file://' + path.resolve(__dirname, 'goal-map.html').replace(/\\/g, '/');
const dataFile = path.resolve(__dirname, process.argv[2] || 'sample-play.json');
const OUT_DIR = path.resolve(__dirname, 'output');

(async () => {
  if (!fs.existsSync(dataFile)) { console.error('❌ ما لقيت:', dataFile); process.exit(1); }
  const play = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 1400, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((p) => { window.PLAY_OVERRIDE = p; }, play);
  await page.goto(TEMPLATE, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await new Promise((r) => setTimeout(r, 500));

  const out = path.join(OUT_DIR, 'goal-map.png');
  await (await page.$('#card')).screenshot({ path: out });
  await browser.close();

  if (play.caption) fs.writeFileSync(path.join(OUT_DIR, 'goal-map.txt'), play.caption, 'utf8');
  console.log('✅ خريطة الهدف:', out);
  if (play.caption) console.log('\n--- الكابشن ---\n' + play.caption);
})().catch((e) => { console.error('❌ خطأ:', e); process.exit(1); });
