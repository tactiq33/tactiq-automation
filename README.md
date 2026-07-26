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

---

## 📄 صفحات الوثائق القانونيّة للتطبيق (`docs/`)

مجلّد `docs/` يستضيف **سياسة الخصوصيّة وشروط الاستخدام** لتطبيق TactIQ (عربيّ + إنجليزيّ في الصفحة نفسها مع مبدّل لغة). سبب وجودها في هذا المستودع: أنّه **عامّ** فيصلح لاستضافة مجّانيّة عبر GitHub Pages، وGoogle Play يطلب رابطاً عامّاً يعمل بلا تسجيل دخول.

| الملفّ | الوظيفة |
|---|---|
| `docs/index.html` | صفحة هبوط تشير للوثيقتين |
| `docs/privacy.html` | سياسة الخصوصيّة (AR + EN) |
| `docs/terms.html` | شروط الاستخدام (AR + EN) |
| `docs/style.css` | تنسيق مشترك (بلا خطوط أو مكتبات خارجيّة) |
| `docs/lang.js` | مبدّل اللغة — وبدون JavaScript تظهر اللغتان معاً فتبقى الصفحة مقروءة دائماً |

### تشغيل الاستضافة (مرّة واحدة)
1. ارفع المجلّد بـGitHub Desktop إلى `tactiq33/tactiq-automation`.
2. GitHub → المستودع → **Settings → Pages**.
3. Source = **Deploy from a branch** · Branch = **main** · Folder = **`/docs`** → **Save**.
4. انتظر دقيقة–دقيقتين، ثمّ تصبح الروابط:
   - `https://tactiq33.github.io/tactiq-automation/privacy.html`
   - `https://tactiq33.github.io/tactiq-automation/terms.html`
5. افتح الرابطين في متصفّح **بلا تسجيل دخول** للتأكّد أنّهما عامّان (Play يرفض رابطاً محميّاً أو 404).

### قواعد صيانة
- **الرابط يُدخَل في Play Console** في: Store listing (Privacy policy) + استبيان Data Safety.
- عند تعديل الوثيقتين: غيّر «تاريخ آخر تحديث» في أعلى الصفحة وفي التذييل، **وفي النسختين العربيّة والإنجليزيّة معاً**.
- ⚠️ **إلزاميّ:** أيّ ميزة جديدة تجمع بيانات (تسجيل دخول Google حقيقيّ · Firestore · تنبيهات Push · Crashlytics · تحليلات) تُحدَّث لها السياسة **قبل** رفع الإصدار الذي يحتويها، ويُحدَّث معها استبيان Data Safety.
- الوثيقتان تصفان **الوضع الحاليّ المفحوص**: لا حساب ولا بيانات شخصيّة · تخزين محلّيّ · اشتراك مشفَّر · AdMob · تنبيهات محلّيّة · بيانات المباريات من `football-data.org` وأخبار RSS.

### ⚠️ نسختان من هذا المجلّد — لا تخلط بينهما
| المسار | ما هو |
|---|---|
| `C:\Users\User\Desktop\test\automation` | **نسخة العمل الأصليّة** — هنا نكتب ونعدّل |
| `C:\Users\User\Documents\GitHub\tactiq-automation` | **نسخة git المربوطة بـGitHub Desktop** — منها يحدث الرفع |

GitHub Desktop لا يرى شيئاً كُتب في نسخة Desktop. لذلك **بعد أيّ تعديل يجب أن يُنشَر، انسخ الملفّات إلى نسخة `Documents\GitHub`** ثمّ Commit + Push. (هذا يفسّر ظهور «No local changes» بعد كتابة مجلّد `docs`.)
