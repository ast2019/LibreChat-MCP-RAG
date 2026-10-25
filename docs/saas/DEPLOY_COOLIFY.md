# استقرار روی Coolify

## پیش‌نیاز

- **سرور:** حداقل ۴ هسته و **۸ گیگابایت RAM**. بیلد فرانت‌اند به حدود ۶ گیگابایت حافظه نیاز دارد. اگر RAM کمتری دارید، متغیر `NODE_MAX_OLD_SPACE_SIZE` را کم کنید، یا image را روی سرور دیگری بسازید و فقط اجرا را روی Coolify انجام دهید.
- **دامنه:** یک دامنه مثل `chat.example.com` که رکورد A آن به سرور Coolify اشاره کند.
- **کلید OpenRouter:** از https://openrouter.ai/keys بسازید.

## مراحل

1. **ساخت منبع:** در Coolify گزینه **New Resource → Public/Private Repository** را بزنید و این مخزن را انتخاب کنید. Branch را `main` بگذارید.
2. **Build Pack:** گزینه **Docker Compose** را انتخاب کنید. مسیر فایل `/docker-compose.yml` است.
3. **دامنه:** در بخش سرویس `api` دامنه را با پورت وارد کنید: `https://chat.example.com:3080`. پورت ۳۰۸۰ فقط مشخص می‌کند proxy به کدام پورت داخلی برود و کاربر همان `https://chat.example.com` را باز می‌کند.
4. **متغیرها:** در بخش **Environment Variables**:
   - `OPENROUTER_KEY` را وارد کنید. این تنها متغیر اجباری است و تا وارد نشود deploy انجام نمی‌شود.
   - همه `SERVICE_*`ها (رمزها، کلیدهای JWT، `CREDS_KEY`، رمز MongoDB و Meilisearch) را خود Coolify یک بار می‌سازد و نگه می‌دارد.
   - **هشدار:** `SERVICE_HEX_64_CREDSKEY` و `SERVICE_HEX_32_CREDSIV` را بعد از اولین اجرا تغییر ندهید، وگرنه اطلاعات رمزشده قابل خواندن نمی‌ماند.
   - متغیرهای اختیاری مثل `APP_TITLE`، `ALLOW_REGISTRATION` و SMTP در `.env.coolify.example` توضیح داده شده‌اند.
5. **Deploy:** اولین بیلد ۱۰ تا ۲۰ دقیقه طول می‌کشد. وقتی healthcheck سرویس `api` (`/health`) سبز شد، سایت آماده است.
6. **حساب ادمین:** **اولین حسابی که ثبت‌نام کند ADMIN می‌شود.** فوراً خودتان ثبت‌نام کنید. اگر نمی‌خواهید هر کسی ثبت‌نام کند، بعد از آن `ALLOW_REGISTRATION=false` بگذارید.
7. **دادن بسته به کاربران:** طبق [BILLING.md](./BILLING.md).

## ورود کاربران

- **ایمیل و رمز عبور:** همیشه فعال است. کاربر هنگام ثبت‌نام نام، نام کاربری، ایمیل و رمز وارد می‌کند و با ایمیل و رمز وارد می‌شود.
- **OpenID Connect (اختیاری):** در Coolify این سه متغیر را بگذارید: `OPENID_ISSUER` (مثلاً `https://accounts.google.com` یا آدرس realm در Keycloak)، `OPENID_CLIENT_ID` و `OPENID_CLIENT_SECRET`. آدرس بازگشت `https://chat.example.com/oauth/openid/callback` را در سرویس OpenID ثبت کنید. بعد از redeploy، دکمه ورود زیر فرم ظاهر می‌شود.
  - متن دکمه: `OPENID_BUTTON_LABEL`
  - اگر نمی‌خواهید کاربر جدید از طریق OpenID ساخته شود: `ALLOW_SOCIAL_REGISTRATION=false`
  - `OPENID_SESSION_SECRET` را Coolify خودش می‌سازد.
  - تا این سه متغیر خالی باشند دکمه نمایش داده نمی‌شود. آدرس `/oauth/openid` در این حالت خطای 500 می‌دهد، که رفتار خود LibreChat است.

## کیفیت جستجو

- **Reranker برای جستجوی وب (اختیاری، پیشنهادی):** `JINA_API_KEY` (از https://jina.ai/reranker) یا `COHERE_API_KEY` را در Coolify بگذارید. اگر هر دو باشند، Jina استفاده می‌شود. بدون کلید، جستجو بدون reranker کار می‌کند.
- **مدل embedding فایل‌ها:** پیش‌فرض `openai/text-embedding-3-large` با ۱۵۳۶ بُعد است. **قبل از اینکه کاربرها فایل آپلود کنند انتخاب نهایی را بکنید.** بعد از تغییر `EMBEDDINGS_MODEL` یا `EMBEDDINGS_DIMENSIONS`، فایل‌های قبلی باید دوباره آپلود شوند، چون بردارهای دو مدل با هم قابل مقایسه نیستند.

## سرویس‌ها

| سرویس | نقش | Volume |
|---|---|---|
| `api` | اپ اصلی (بیلد از `Dockerfile.multi` با target `api-build`) | `uploads`، `images`، `logs`، `librechat-data` |
| `mongodb` | پایگاه داده اصلی (با احراز هویت) | `mongodb-data` |
| `meilisearch` | جستجو در گفتگوها | `meili-data` |
| `vectordb` + `rag_api` | پرسش از فایل‌ها (RAG). embedding از OpenRouter با `openai/text-embedding-3-large` (۱۵۳۶ بُعد) | `pgvector-data`، `rag-uploads` |
| `searxng` | موتور جستجوی وب خصوصی، فقط داخلی | — |

**بکاپ:** در Coolify بخش **Persistent Storage** بکاپ volume `mongodb-data` را فعال کنید. موجودی و تراکنش‌های کاربران آنجاست.

## تغییر تنظیمات

- **مدل‌ها، ضریب قیمت، بسته‌ها و متن‌های UI** در `config/librechat.saas.yaml` هستند. فایل را ویرایش کنید و commit کنید (از طریق PR). Coolify با webhook دوباره deploy می‌کند.
- برای استفاده از کانفیگ بیرونی بدون rebuild، `CONFIG_PATH` را در Coolify روی یک URL با `https` بگذارید. LibreChat کانفیگ را از URL هم می‌خواند.

## اجرای محلی همین stack

```bash
cp .env.coolify.example .env    # مقادیر را پر کنید (دستور openssl کنار هر کلید آمده)
docker compose up -d --build
# http://localhost:3080
```

## عیب‌یابی

| مشکل | علت محتمل |
|---|---|
| بیلد با `JavaScript heap out of memory` شکست می‌خورد | RAM کم است. `NODE_MAX_OLD_SPACE_SIZE` را کم کنید یا RAM اضافه کنید |
| `No Available Server` | دامنه بدون `:3080` وارد شده، یا `api` هنوز healthy نشده است |
| جستجوی وب نتیجه ندارد | لاگ `searxng` را ببینید. بعضی موتورها از IP دیتاسنتر CAPTCHA می‌گیرند؛ لیست موتورها در `deploy/searxng/settings.yml` و `webSearch.searxngSearchOptions.engines` است |
| آپلود فایل برای پرسش کار نمی‌کند | لاگ `rag_api` را ببینید. اعتبار OpenRouter و مدل embedding را بررسی کنید |
