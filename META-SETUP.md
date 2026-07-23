# تجهيز Meta — نشر بوستات TactIQ تلقائيًّا على فيسبوك + إنستغرام

الهدف: النشر المجدول (لسنة) على FB+IG تلقائيًّا عبر GitHub Actions — بلا حاسوبك.

## المتطلّبات (مرّة وحدة)
1. **صفحة فيسبوك** (عندك ✅).
2. **حساب إنستغرام Professional/Business** + **مربوط بصفحة الفيسبوك** (من Meta Business Suite ← Settings ← Linked accounts).

## الخطوات

### ١) اعمل تطبيق Meta
- روح [developers.facebook.com](https://developers.facebook.com/) ← My Apps ← **Create App** ← نوع **Business**.
- جوّا التطبيق: Add Products ← أضف **Instagram Graph API** و **Facebook Login**.

### ٢) خُذ الصلاحيات (Graph API Explorer)
- افتح **Graph API Explorer** (من قائمة Tools).
- اختر تطبيقك، واطلب هالصلاحيّات (Permissions):
  - `pages_show_list`
  - `pages_manage_posts`
  - `pages_read_engagement`
  - `instagram_basic`
  - `instagram_content_publish`
  - `business_management`
- اضغط **Generate Access Token** ووافق.

### ٣) جيب Page ID + Page Token
- بالـExplorer نفّذ:  `GET /me/accounts`
- بيرجّعلك صفحاتك — انسخ **`id`** (Page ID) و **`access_token`** تبع الصفحة.

### ٤) جيب Instagram Business ID
- نفّذ:  `GET /{PAGE_ID}?fields=instagram_business_account`
- بيرجّعلك **`instagram_business_account.id`** — هيدا IG_USER_ID.

### ٥) توكن طويل الأمد (مهمّ)
- التوكن الافتراضيّ بينتهي بساعات. للطويل (~٦٠ يوم):
  `GET /oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={TOKEN}`
- **للأبديّ (ما بينتهي):** اعمل **System User** من Business Manager ← Settings ← System Users، وأصدر توكن إلو (بينفع للنشر الدائم بلا تجديد).

> ملاحظة: للنشر على **صفحاتك أنت** (كأدمن للتطبيق) بيشتغل بوضع التطوير بلا مراجعة تطبيق كاملة. المراجعة بتلزم بس لو التطبيق عامّ لمستخدمين غيرك.

### ٦) استضافة الصور (ضروريّ لإنستغرام)
إنستغرام بدّو **رابط صورة عامّ**. أسهل حلّ مجّانيّ:
- ارفع مجلّد `automation/output/images` على **مستودع GitHub عامّ**.
- `BASE_URL = https://raw.githubusercontent.com/USERNAME/REPO/main/automation/output/images`

### ٧) عبّي القيم
**محليًّا (للتجربة):** بملف `automation/.env`:
```
FB_PAGE_ID=...
FB_PAGE_TOKEN=...
IG_USER_ID=...
IG_TOKEN=...            (نفس Page token عادةً)
BASE_URL=...
POST_LANG=ar
```
**على GitHub (للتلقائيّ):** Repo ← Settings ← Secrets and variables ← Actions:
- Secrets: `FB_PAGE_ID`, `FB_PAGE_TOKEN`, `IG_USER_ID`, `IG_TOKEN`
- Variables: `BASE_URL`, `POST_LANG`, `GRAPH_VERSION`

### ٨) جرّب
```
cd automation
node build-schedule.js            # لو ما عملت الجدول بعد
node publish.js --dry-run         # تجربة بلا نشر
node publish.js                   # نشر فعليّ للمستحقّ
```

### ٩) التلقائيّ بلا حاسوبك
ملفّ `.github/workflows/publish.yml` بيشتغل بالمواعيد (cron) على GitHub وينشر المستحقّ. عدّل أوقات الـcron حسب توقيتك.

## ملاحظات
- التوكن العاديّ بينتهي — استعمل System User token للدوام.
- كل المفاتيح Secrets — ما تحطّها بالكود.
- FB بيدعم جدولة مستقبليّة بالـAPI؛ IG بينشر باللحظة، فمنعتمد على cron ينشر يوميًّا المستحقّ = تغطية سنة كاملة تلقائيًّا.
