# TactIQ — أتمتة النشر (فيسبوك + إنستغرام + تيك توك)

أداة تجهّز محتوى TactIQ مرّة وحدة وتنشره تلقائيًّا حسب جدول سنة كاملة.

## شو بتعمل
1. **تصدير الصور** — تصدّر كل البوستات (عربي+إنجليزي) + الكوفر + البروفايل من ملف القوالب → `output/images/`.
2. **بناء الجدول** — تبني رزنامة ٥٢ أسبوع (٣ منشورات/أسبوع + ستوري + خانات فيديو فاضية) → `output/schedule.json` و `schedule.csv`.
3. **النشر** — تنشر المستحقّ على فيسبوك + إنستغرام (وتيك توك للفيديو لاحقًا).

---

## أوّلاً: التجهيز (مرّة وحدة، بلا مفاتيح)
```
cd automation
npm install
npm run export      # يصدّر كل الصور + manifest.json
npm run schedule    # يبني جدول السنة
```
خيارات الجدول:
```
npm run schedule -- --start=2026-08-01 --weeks=52
```

النتيجة بمجلّد `output/`:
- `images/*.png` — كل الصور جاهزة.
- `manifest.json` — بيانات كل صورة + الكابشن (عربي/إنجليزي) + الهاشتاغات.
- `schedule.json` / `schedule.csv` — جدول النشر.

> **الأسهل بلا كود:** افتح `schedule.csv` واستوردو على **Meta Business Suite** أو **Buffer/Metricool** وجدول منّو مباشرة. وبس. (ما بتحتاج باقي الخطوات).

---

## ثانيًا: النشر التلقائيّ بالـAPI (اختياريّ — للمؤتمت بالكامل)

### أ. مفاتيح Meta (فيسبوك + إنستغرام)
1. اعمل تطبيق على [Meta for Developers](https://developers.facebook.com/) (نوع Business).
2. اربط صفحة الفيسبوك + حساب إنستغرام (Business) المربوط فيها.
3. خُذ الصلاحيات: `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`.
4. احصل على: **Page ID**, **Page Access Token** (طويل الأمد), **Instagram User ID**.
5. انسخ `.env.example` باسم `.env` واملأ القيم.

### ب. رابط الصور العامّ (ضروريّ لإنستغرام)
إنستغرام بدّو **رابط صورة عامّ**. أسهل حلّ مجّاني: ارفع مجلّد `automation/output/images` على مستودع GitHub **عامّ**، وحطّ بـ `.env`:
```
BASE_URL=https://raw.githubusercontent.com/USERNAME/REPO/main/automation/output/images
```

### ج. جرّب بلا نشر فعليّ
```
node publish.js --dry-run
```
### د. نشر فعليّ للمستحقّ
```
node publish.js
```

---

## ثالثًا: النشر بلا حاسوبك (GitHub Actions — مجّاني)
1. ارفع مجلّد المشروع على مستودع GitHub.
2. بإعدادات المستودع → **Secrets and variables → Actions**:
   - **Secrets:** `FB_PAGE_ID`, `FB_PAGE_TOKEN`, `IG_USER_ID`, `IG_TOKEN`, `TIKTOK_TOKEN`.
   - **Variables:** `BASE_URL`, `POST_LANG`, `GRAPH_VERSION`.
3. ملفّ `.github/workflows/publish.yml` بيشتغل بالمواعيد (cron بالـUTC — عدّلو حسب توقيتك) وينشر المستحقّ.
4. فيك تشغّلو يدويًّا من تبويب **Actions → Run workflow**.

> هيك بينشر من سيرفرات GitHub، وحاسوبك مطفّي.

---

## الفيديوهات
- إنت بتعمل الفيديوهات بإيدك (متل ما اتّفقنا). حطّ ملف الفيديو، وعبّي **خانة الفيديو الفاضية** (`media_type: VIDEO_SLOT`) بالجدول: غيّر `media_type` لـ`VIDEO`، وحطّ اسم الملفّ والكابشن، وخلّي `status: pending`.
- تيك توك للفيديو فقط، والـAPI بدّو موافقة تطبيق رسميّة — لهيك مبدئيًّا الفيديو للفيسبوك+إنستغرام، وتيك توك لمّا تجهّز الموافقة.

## تحديث المحتوى لاحقًا
- عدّلت البوستات بالـHTML؟ شغّل `npm run export` من جديد، وبعدها `npm run schedule` لو بدّك تعيد بناء الجدول.

## أمان
- كل المفاتيح بـ `.env` (مش مرفوع على GitHub). ما في مفاتيح داخل الكود.
- على GitHub استعمل **Secrets** — ما تحطّ المفاتيح بالكود أبداً.
