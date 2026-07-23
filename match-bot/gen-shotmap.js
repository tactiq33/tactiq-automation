/**
 * gen-shotmap.js — يولّد خريطة تسديدات + xG (PNG) من ملف shots JSON.
 * التشغيل:  node gen-shotmap.js [shots.json]
 * مصدر البيانات: Understat (الدوريات الخمسة) — شوف understat-fetch.js.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE = 'file://' + path.resolve(__dirname, 'shotmap.html').replace(/\\/g, '/');
const dataFile = path.resolve(__dirname, process.argv[2] || 'sample-shots.json');
const OUT_DIR = path.resolve(__dirname, 'output');

(async () => {
  if (!fs.existsSync(dataFile)) { console.error('❌ ما لقيت:', dataFile); process.exit(1); }
  const shots = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 1400, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((d) => { window.SHOTS_OVERRIDE = d; }, shots);
  await page.goto(TEMPLATE, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await new Promise((r) => setTimeout(r, 500));
  const out = path.join(OUT_DIR, 'shotmap.png');
  await (await page.$('#card')).screenshot({ path: out });
  await browser.close();
  if (shots.caption) fs.writeFileSync(path.join(OUT_DIR, 'shotmap.txt'), shots.caption, 'utf8');
  console.log('✅ خريطة التسديدات:', out);
})().catch((e) => { console.error('❌ خطأ:', e); process.exit(1); });
