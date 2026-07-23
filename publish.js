/**
 * publish.js — ينشر المنشورات المستحقّة (تاريخها/وقتها وصل) من output/schedule.json
 * على فيسبوك + إنستغرام (Meta Graph API)، ودعم أوّليّ لتيك توك (فيديو).
 *
 * ⚠️ ملاحظات مهمّة:
 *  - إنستغرام بدّو رابط صورة عامّ (public URL). لهيك الصور لازم تكون مرفوعة على مكان عامّ
 *    (مثلًا مستودع GitHub عامّ) وتحطّ رابطه بـ BASE_URL بملف .env.
 *  - المفاتيح كلها بتحطّها إنت بملف .env (انسخ .env.example). ما في مفاتيح داخل الكود.
 *
 * التشغيل:
 *   node publish.js --dry-run   → تجربة بلا نشر فعليّ (بيطبع شو رح ينشر)
 *   node publish.js             → نشر فعليّ للمستحقّ
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, 'output');
const SCHEDULE = path.join(OUT_DIR, 'schedule.json');

const DRY = process.argv.includes('--dry-run');
const GV = process.env.GRAPH_VERSION || 'v21.0';
const LANG = (process.env.POST_LANG || 'ar').toLowerCase();
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, ''); // رابط مجلّد الصور العامّ

const cfg = {
  fbPage: process.env.FB_PAGE_ID,
  fbToken: process.env.FB_PAGE_TOKEN,
  igUser: process.env.IG_USER_ID,
  igToken: process.env.IG_TOKEN || process.env.FB_PAGE_TOKEN,
  ttToken: process.env.TIKTOK_TOKEN,
};

// رابط الفيديوهات العامّ. افتراضيًّا: نفس مجلّد الصور مع استبدال /images بـ/videos.
const VIDEO_BASE_URL = (process.env.VIDEO_BASE_URL || (BASE_URL ? BASE_URL.replace(/\/images$/, '/videos') : '')).replace(/\/$/, '');

function log(...a) { console.log(...a); }
function imgUrl(file) { return BASE_URL + '/' + file; }
function videoUrl(file) { return VIDEO_BASE_URL + '/' + file; }

async function graph(url, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(url, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error('Graph error: ' + JSON.stringify(json.error || json));
  }
  return json;
}

async function graphGet(url) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error('Graph GET error: ' + JSON.stringify(json.error || json));
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== فيسبوك =====
async function publishFacebook(item, caption) {
  if (!cfg.fbPage || !cfg.fbToken) throw new Error('FB_PAGE_ID / FB_PAGE_TOKEN ناقصين بـ .env');
  const file = LANG === 'en' ? item.image_en : item.image_ar;
  const url = `https://graph.facebook.com/${GV}/${cfg.fbPage}/photos`;
  const r = await graph(url, { url: imgUrl(file), caption, access_token: cfg.fbToken });
  return 'FB post id: ' + (r.post_id || r.id);
}

// ===== إنستغرام (خطوتين: إنشاء حاوية ثم نشر) =====
async function publishInstagram(item, caption) {
  if (!cfg.igUser || !cfg.igToken) throw new Error('IG_USER_ID / IG_TOKEN ناقصين بـ .env');
  const file = LANG === 'en' ? item.image_en : item.image_ar;
  const createUrl = `https://graph.facebook.com/${GV}/${cfg.igUser}/media`;
  const params = { image_url: imgUrl(file), access_token: cfg.igToken };
  if (item.media_type === 'STORY') params.media_type = 'STORIES';
  else params.caption = caption;
  const created = await graph(createUrl, params);
  const publishUrl = `https://graph.facebook.com/${GV}/${cfg.igUser}/media_publish`;
  const pub = await graph(publishUrl, { creation_id: created.id, access_token: cfg.igToken });
  return 'IG media id: ' + pub.id;
}

// ===== فيديو فيسبوك (من رابط عامّ) =====
async function publishFacebookVideo(item, caption) {
  if (!cfg.fbPage || !cfg.fbToken) throw new Error('FB_PAGE_ID / FB_PAGE_TOKEN ناقصين بـ .env');
  const url = `https://graph.facebook.com/${GV}/${cfg.fbPage}/videos`;
  const r = await graph(url, { file_url: videoUrl(item.video), description: caption, access_token: cfg.fbToken });
  return 'FB video id: ' + (r.id);
}

// ===== فيديو إنستغرام (Reels): إنشاء حاوية → انتظار المعالجة → نشر =====
async function publishInstagramVideo(item, caption) {
  if (!cfg.igUser || !cfg.igToken) throw new Error('IG_USER_ID / IG_TOKEN ناقصين بـ .env');
  const createUrl = `https://graph.facebook.com/${GV}/${cfg.igUser}/media`;
  const created = await graph(createUrl, {
    media_type: 'REELS', video_url: videoUrl(item.video), caption, share_to_feed: 'true', access_token: cfg.igToken,
  });
  // انتظر لين تخلص المعالجة (حتى ~٢.٥ دقيقة)
  const statusUrl = `https://graph.facebook.com/${GV}/${created.id}?fields=status_code&access_token=${encodeURIComponent(cfg.igToken)}`;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const st = await graphGet(statusUrl);
    if (st.status_code === 'FINISHED') { ready = true; break; }
    if (st.status_code === 'ERROR') throw new Error('IG video processing ERROR');
  }
  if (!ready) throw new Error('IG video processing timeout');
  const pub = await graph(`https://graph.facebook.com/${GV}/${cfg.igUser}/media_publish`, { creation_id: created.id, access_token: cfg.igToken });
  return 'IG reel id: ' + pub.id;
}

// ===== تيك توك (فيديو فقط — يحتاج موافقة تطبيق) =====
async function publishTikTok(item) {
  // تيك توك للفيديو فقط، والـContent Posting API بدّو موافقة رسميّة.
  // هون stub — بينشر مسودّة/ينبّه. عبّيه لمّا تجهّز الموافقة.
  if (!cfg.ttToken) { log('   ⏭️  تيك توك: TIKTOK_TOKEN ناقص — تخطّي.'); return 'skipped'; }
  log('   ℹ️  تيك توك: يحتاج فيديو + موافقة تطبيق. راجع README لخطوات التفعيل.');
  return 'tiktok pending setup';
}

function isDue(item, now) {
  const dt = new Date(item.date + 'T' + (item.time || '12:00') + ':00');
  return dt.getTime() <= now.getTime();
}

(async () => {
  if (!fs.existsSync(SCHEDULE)) {
    console.error('❌ ما لقيت schedule.json — شغّل: npm run schedule');
    process.exit(1);
  }
  if (!BASE_URL && !DRY) {
    console.error('❌ BASE_URL ناقص بـ .env (رابط مجلّد الصور العامّ) — لازم لإنستغرام.');
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(SCHEDULE, 'utf8'));
  const now = new Date();
  const due = rows.filter((r) => r.status === 'pending' && r.media_type !== 'VIDEO_SLOT' && isDue(r, now));

  if (due.length === 0) { log('✅ ما في منشورات مستحقّة هلّق.'); return; }
  log(`📤 ${due.length} منشور مستحقّ${DRY ? ' (تجربة — بلا نشر فعليّ)' : ''}:`);

  for (const item of due) {
    const caption = ((LANG === 'en' ? item.caption_en : item.caption_ar) || '') +
      (item.hashtags ? '\n\n' + item.hashtags : '');
    const mediaName = item.media_type === 'VIDEO' ? item.video : (LANG === 'en' ? item.image_en : item.image_ar);
    log(`\n• ${item.date} ${item.time} — ${item.media_type} — ${mediaName}`);

    if (DRY) { log('   (تجربة) الكابشن:', caption.replace(/\n/g, ' ').slice(0, 80) + '…'); continue; }

    const results = [];
    try {
      const isVideo = item.media_type === 'VIDEO';
      for (const p of item.platforms) {
        if (p === 'facebook') results.push(isVideo ? await publishFacebookVideo(item, caption) : await publishFacebook(item, caption));
        else if (p === 'instagram') results.push(isVideo ? await publishInstagramVideo(item, caption) : await publishInstagram(item, caption));
        else if (p === 'tiktok') results.push(await publishTikTok(item));
      }
      item.status = 'done';
      item.published_at = new Date().toISOString();
      item.result = results.join(' | ');
      log('   ✅', results.join(' | '));
    } catch (e) {
      item.status = 'error';
      item.error = String(e.message || e);
      log('   ❌', item.error);
    }
    fs.writeFileSync(SCHEDULE, JSON.stringify(rows, null, 2), 'utf8'); // احفظ بعد كل عنصر
  }

  log('\n🎉 خلص. تحديث الحالات محفوظ بـ schedule.json');
})().catch((e) => { console.error('❌ خطأ:', e); process.exit(1); });
