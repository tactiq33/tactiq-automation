/**
 * export-images.js
 * يفتح ملف قوالب البوستات، يبدّل اللغة (عربي/إنجليزي)، ويصدّر كل بوست كصورة PNG.
 * كمان بيطلّع manifest.json فيه بيانات كل صورة + الكابشن (عربي/إنجليزي) + الهاشتاغات.
 *
 * التشغيل:  npm run export
 * النتيجة:  مجلّد ./output/images/*.png  +  ./output/manifest.json
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const HTML_FILE = path.resolve(__dirname, '..', 'design-mockups', 'tactiq-social-posts.html');
const OUT_DIR = path.resolve(__dirname, 'output');
const IMG_DIR = path.join(OUT_DIR, 'images');

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// اسم مقروء لكل بوست حسب صنفه وترتيبه
function buildNames(metaList) {
  let postCounter = 0;
  return metaList.map((m) => {
    if (m.cls.includes('cover')) return 'cover';
    if (m.cls.includes('pfp')) return 'profile';
    if (m.cls.includes('story')) return 'story';
    postCounter += 1;
    return 'post-' + String(postCounter).padStart(2, '0');
  });
}

(async () => {
  if (!fs.existsSync(HTML_FILE)) {
    console.error('❌ ما لقيت ملف القوالب:', HTML_FILE);
    process.exit(1);
  }
  ensureDir(IMG_DIR);

  console.log('🚀 عم يفتح المتصفّح...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1760, height: 1100, deviceScaleFactor: 1 });

  const fileUrl = 'file://' + HTML_FILE.replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });

  // انتظر تحميل الخطوط + حقن الكابشن/الأزرار
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await new Promise((r) => setTimeout(r, 800));

  // خبّي أزرار التحميل حتى ما تطلع بالصور
  await page.addStyleTag({ content: '.dlbtn{display:none!important;}' });

  // اقرأ بيانات كل بوست + الكابشنز
  const meta = await page.evaluate(() => {
    const posts = Array.from(document.querySelectorAll('.post'));
    const caps = (typeof CAPTIONS !== 'undefined') ? CAPTIONS : [];
    return posts.map((p, i) => ({
      cls: p.className,
      cap: caps[i] || null,
    }));
  });

  const names = buildNames(meta);
  const manifest = [];

  for (const lang of ['ar', 'en']) {
    await page.evaluate((l) => setLang(l), lang);
    await new Promise((r) => setTimeout(r, 400));

    const handles = await page.$$('.post');
    for (let i = 0; i < handles.length; i++) {
      const base = names[i];
      const file = `${base}-${lang}.png`;
      await handles[i].screenshot({ path: path.join(IMG_DIR, file) });

      const cap = meta[i].cap;
      manifest.push({
        file,
        name: base,
        lang,
        type: meta[i].cls.includes('cover') ? 'cover'
          : meta[i].cls.includes('pfp') ? 'profile'
          : meta[i].cls.includes('story') ? 'story' : 'post',
        caption: cap ? (lang === 'ar' ? cap.ar : cap.en) : '',
        hashtags: cap ? (cap.t || '') : '',
        format: cap ? (cap.f || '') : '',
      });
      console.log('  ✅', file);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await browser.close();

  const imgCount = manifest.length;
  console.log(`\n🎉 خلص! صدّرت ${imgCount} صورة على: ${IMG_DIR}`);
  console.log(`🧾 manifest.json فيه الكابشنز على: ${path.join(OUT_DIR, 'manifest.json')}`);
})().catch((e) => { console.error('❌ خطأ:', e); process.exit(1); });
