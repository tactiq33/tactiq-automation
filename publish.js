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

// Every network call gets a hard timeout. Node's fetch has NO default timeout, so
// one stalled connection used to hang the whole GitHub Actions job until the 6-hour
// runner limit killed it — which is reported as "All jobs were cancelled" and looks
// like a mystery. A timeout turns that silent hang into a normal, readable error.
const NET_TIMEOUT_MS = Number(process.env.NET_TIMEOUT_MS || 45000);

async function fetchWithTimeout(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NET_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`network timeout after ${NET_TIMEOUT_MS}ms: ${String(url).split('?')[0]}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function graph(url, params) {
  const body = new URLSearchParams(params);
  const res = await fetchWithTimeout(url, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error('Graph error: ' + JSON.stringify(json.error || json));
  }
  return json;
}

async function graphGet(url) {
  const res = await fetchWithTimeout(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error('Graph GET error: ' + JSON.stringify(json.error || json));
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Publishing to a Page/IG needs a PAGE access token. If a User/System-User
// token was supplied (e.g. a System User token), derive the Page token from it
// automatically — otherwise the Graph API returns "(#200) publish_actions...".
async function resolvePageToken() {
  try {
    const r = await graphGet(`https://graph.facebook.com/${GV}/${cfg.fbPage}?fields=access_token&access_token=${encodeURIComponent(cfg.fbToken)}`);
    if (r && r.access_token) {
      cfg.fbToken = r.access_token;
      cfg.igToken = r.access_token;
      log('   🔑 Using derived Page access token.');
    }
  } catch (e) {
    log('   ⚠️ Could not derive Page token, using the provided token:', e.message);
  }
}

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

  // ⚠️ Instagram needs a moment to fetch and process the image even for photos and
  // stories. Publishing straight after creating the container fails with
  // 9007 / 2207027 "The media is not ready to be published" — that is exactly what
  // killed the 2026-08-09 post. So wait for the container, then publish with retries.
  await waitForContainer(created.id);

  const publishUrl = `https://graph.facebook.com/${GV}/${cfg.igUser}/media_publish`;
  const pub = await publishWithRetry(publishUrl, created.id);
  return 'IG media id: ' + pub.id;
}

/** Polls a media container until Instagram reports FINISHED (or gives up). */
async function waitForContainer(containerId, tries = 12, waitMs = 5000) {
  const statusUrl = `https://graph.facebook.com/${GV}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(cfg.igToken)}`;
  for (let i = 0; i < tries; i++) {
    await sleep(waitMs);
    let st;
    try { st = await graphGet(statusUrl); } catch { continue; }  // transient read errors are not fatal
    if (st.status_code === 'FINISHED') return true;
    if (st.status_code === 'ERROR') throw new Error('IG container ERROR: ' + (st.status || 'unknown'));
  }
  return false; // not confirmed — publishWithRetry still gives it a few chances
}

/** Publishes a container, retrying only the "not ready yet" error. */
async function publishWithRetry(publishUrl, creationId, tries = 5, waitMs = 8000) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await graph(publishUrl, { creation_id: creationId, access_token: cfg.igToken });
    } catch (e) {
      last = e;
      const msg = String(e.message || e);
      const notReady = msg.includes('2207027') || msg.includes('not ready') || msg.includes('Media ID is not available');
      if (!notReady) throw e;          // a real error must surface immediately
      log(`   … IG not ready, retry ${i + 1}/${tries}`);
      await sleep(waitMs);
    }
  }
  throw last;
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

// ===== فحص المفاتيح بلا نشر (node publish.js --check) =====
// يطبع صلاحيّة توكن Meta وتاريخ انتهائه، وهل صفحة الفيسبوك وحساب إنستغرام مقروءين،
// بلا ما ينشر شي. المفاتيح نفسها ما بتنطبع أبدًا.
function note(level, title, msg) {
  log(`${level === 'error' ? '❌' : level === 'warning' ? '⚠️' : 'ℹ️'} ${title}: ${msg}`);
  if (process.env.GITHUB_ACTIONS) log(`::${level} title=${title}::${msg}`);
}
const fmtDate = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : 'never');

async function checkTokens() {
  let ok = true;
  if (!cfg.fbPage || !cfg.fbToken) { note('error', 'Meta', 'FB_PAGE_ID / FB_PAGE_TOKEN missing'); return false; }
  try {
    const d = (await graphGet(`https://graph.facebook.com/${GV}/debug_token?input_token=${encodeURIComponent(cfg.fbToken)}&access_token=${encodeURIComponent(cfg.fbToken)}`)).data || {};
    if (!d.is_valid) { note('error', 'Meta token', 'FB_PAGE_TOKEN is NOT valid' + (d.error ? ' — ' + d.error.message : '')); ok = false; }
    else {
      const days = d.expires_at ? Math.floor((d.expires_at * 1000 - Date.now()) / 86400000) : null;
      const level = days != null && days < 14 ? 'warning' : 'notice';
      note(level, 'Meta token', `valid · type ${d.type} · expires ${fmtDate(d.expires_at)}${days != null ? ` (${days} days)` : ''} · data access until ${fmtDate(d.data_access_expires_at)}`);
    }
  } catch (e) {
    note('warning', 'Meta token', 'debug_token unreadable: ' + e.message);
  }
  await resolvePageToken();
  try {
    const p = await graphGet(`https://graph.facebook.com/${GV}/${cfg.fbPage}?fields=name&access_token=${encodeURIComponent(cfg.fbToken)}`);
    note('notice', 'Facebook page', `reachable: ${p.name}`);
  } catch (e) { note('error', 'Facebook page', e.message); ok = false; }
  if (cfg.igUser) {
    try {
      const u = await graphGet(`https://graph.facebook.com/${GV}/${cfg.igUser}?fields=username&access_token=${encodeURIComponent(cfg.igToken)}`);
      note('notice', 'Instagram', `reachable: @${u.username}`);
    } catch (e) { note('error', 'Instagram', e.message); ok = false; }
  } else { note('error', 'Instagram', 'IG_USER_ID missing'); ok = false; }
  if (!cfg.ttToken) note('notice', 'TikTok', 'TIKTOK_TOKEN not set — TikTok posting stays off (needs app approval)');
  return ok;
}

function isDue(item, now) {
  const dt = new Date(item.date + 'T' + (item.time || '12:00') + ':00');
  return dt.getTime() <= now.getTime();
}

(async () => {
  if (process.argv.includes('--check')) {
    const ok = await checkTokens();
    if (!ok) process.exitCode = 1;
    return;
  }
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
  // ⚠️ Root cause of "the bot stopped posting": a single failure set status to
  // 'error', and only 'pending' items were ever retried — so one bad night killed
  // the rest of the schedule silently. Failed items are now retried on the next run
  // (up to RETRY_LIMIT attempts) unless RETRY_ERRORS=0 is set.
  const RETRY_ERRORS = process.env.RETRY_ERRORS !== '0';
  const RETRY_LIMIT = Number(process.env.RETRY_LIMIT || 5);
  const retryable = (r) => RETRY_ERRORS && r.status === 'error' && (r.attempts || 0) < RETRY_LIMIT;
  const due = rows.filter((r) => (r.status === 'pending' || retryable(r)) && r.media_type !== 'VIDEO_SLOT' && isDue(r, now));

  if (due.length === 0) { log('✅ ما في منشورات مستحقّة هلّق.'); return; }
  log(`📤 ${due.length} منشور مستحقّ${DRY ? ' (تجربة — بلا نشر فعليّ)' : ''}:`);

  if (!DRY) await resolvePageToken();

  for (const item of due) {
    const caption = ((LANG === 'en' ? item.caption_en : item.caption_ar) || '') +
      (item.hashtags ? '\n\n' + item.hashtags : '');
    const mediaName = item.media_type === 'VIDEO' ? item.video : (LANG === 'en' ? item.image_en : item.image_ar);
    log(`\n• ${item.date} ${item.time} — ${item.media_type} — ${mediaName}`);

    // ⚠️ عنصر بلا ملفّ (خانة post-23 غير الموجودة بالجدول القديم) كان يُرسَل لـMeta خمس
    // مرّات ويرجع «Missing or invalid image file». الآن يُعلَّم مرّة وحدة بسبب واضح.
    if (!mediaName) {
      log('   ⏭️  بلا ملفّ صورة/فيديو بالجدول — ما رح ينبعت');
      if (!DRY) {
        item.status = 'error';
        item.attempts = RETRY_LIMIT;
        item.error = 'no media file in schedule.json for this slot';
        fs.writeFileSync(SCHEDULE, JSON.stringify(rows, null, 2), 'utf8');
      }
      continue;
    }

    if (DRY) { log('   (تجربة) الكابشن:', caption.replace(/\n/g, ' ').slice(0, 80) + '…'); continue; }

    // المنصّات اللي نجحت تنحفظ: إذا فشل إنستغرام بعد ما نجح فيسبوك، الإعادة ما
    // بتنشر على فيسبوك مرّة تانية (كانت تعطي منشور مكرّر عالصفحة).
    item.done_platforms = item.done_platforms || [];
    const results = item.partial_results || [];
    try {
      const isVideo = item.media_type === 'VIDEO';
      for (const p of item.platforms) {
        if (item.done_platforms.includes(p)) continue;
        let r;
        if (p === 'facebook') r = isVideo ? await publishFacebookVideo(item, caption) : await publishFacebook(item, caption);
        else if (p === 'instagram') r = isVideo ? await publishInstagramVideo(item, caption) : await publishInstagram(item, caption);
        else if (p === 'tiktok') r = await publishTikTok(item);
        if (r) results.push(r);
        item.done_platforms.push(p);
        item.partial_results = results;
        fs.writeFileSync(SCHEDULE, JSON.stringify(rows, null, 2), 'utf8');
      }
      item.status = 'done';
      item.published_at = new Date().toISOString();
      item.result = results.join(' | ');
      delete item.partial_results;
      delete item.error;
      log('   ✅', results.join(' | '));
    } catch (e) {
      item.attempts = (item.attempts || 0) + 1;  // so a permanently broken item stops eventually
      item.status = 'error';
      item.error = String(e.message || e);
      log('   ❌', item.error);
    }
    fs.writeFileSync(SCHEDULE, JSON.stringify(rows, null, 2), 'utf8'); // احفظ بعد كل عنصر
  }

  log('\n🎉 خلص. تحديث الحالات محفوظ بـ schedule.json');
})().catch((e) => { console.error('❌ خطأ:', e); process.exit(1); });
