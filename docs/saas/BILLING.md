# قیمت‌گذاری، بسته‌ها و مصرف

## واحد

موجودی هر کاربر به **اعتبار (credit)** نگه داشته می‌شود:

> **1,000,000 اعتبار = 1 دلار مصرف با قیمت فروش شما**

کاربر این عدد را نمی‌بیند. با `balance.display: percent` فقط نوار پیشرفت و «X٪ مصرف شده» نمایش داده می‌شود. این نوار در دو جا هست:
- حلقه کنار کادر پیام
- منوی حساب، زیر ایمیل

## هشدار اتمام اعتبار

وقتی کاربر ۹۰٪ اعتبارش را مصرف کند، یک هشدار زرد بالای کادر پیام ظاهر می‌شود. وقتی اعتبار تمام شود، هشدار قرمز می‌شود. اگر `balance.purchaseUrl` تنظیم شده باشد، دکمه «خرید بسته» در یک تب جدید به آن آدرس می‌رود. فعلاً درگاه پرداخت نداریم، پس می‌توانید آن را به صفحه تماس یا تلگرام پشتیبانی بدهید:

```yaml
balance:
  purchaseUrl: 'https://t.me/your_support'
```

بدون `purchaseUrl` هشدار بدون دکمه نمایش داده می‌شود. کاربر می‌تواند هشدار را ببندد؛ هشدار اتمام کامل دوباره ظاهر می‌شود.

## فرمول کسر اعتبار

برای هر پاسخ:

```
اعتبار کسرشده = توکن ورودی  × قیمت ورودی OpenRouter (دلار برای هر ۱M توکن) × priceMultiplier
              + توکن خروجی × قیمت خروجی OpenRouter × priceMultiplier
              (+ توکن‌های cache با قیمت cache همان مدل × priceMultiplier)
```

- **قیمت‌ها خودکار هستند.** LibreChat لیست مدل‌ها را از `https://openrouter.ai/api/v1/models` می‌گیرد. این لیست شامل قیمت دلاری هر مدل، از جمله `input_cache_read` و `input_cache_write`، است و در cache نگه داشته می‌شود. اگر OpenRouter قیمتی را تغییر دهد، بعد از ری‌استارت سرویس یا منقضی شدن cache اعمال می‌شود.
- **حاشیه سود شما `priceMultiplier` است** و در `config/librechat.saas.yaml` تنظیم می‌شود:
  ```yaml
  endpoints:
    custom:
      - name: 'OpenRouter'
        priceMultiplier: 1.3   # 30% بالاتر از قیمت OpenRouter
  ```
  برای تغییر آن، فایل را ویرایش کنید، push کنید و Coolify دوباره deploy می‌کند. cache قیمت پاک کردن لازم ندارد، چون ضریب هنگام خواندن اعمال می‌شود.
- مدل‌های روتر مثل `openrouter/fusion` که قیمتشان `-1` (پویا) اعلام شده، از قیمت خودکار کنار گذاشته می‌شوند. قبل از این تغییر، این مدل‌ها به اشتباه **۱ دلار برای هر توکن** حساب می‌شدند.

**مثال واقعی** (قیمت‌های OpenRouter در ۲۳ اکتبر ۲۰۲۶، ضریب 1.3):

| مدل | OpenRouter ورودی / خروجی (دلار برای هر ۱M) | قیمت فروش |
|---|---|---|
| `~google/gemini-flash-latest` (سریع) | 0.75 / 3.75 | 0.975 / 4.875 |
| `~anthropic/claude-sonnet-latest` (هوشمند) | 2 / 10 | 2.6 / 13 |
| `perplexity/sonar-pro` | 3 / 15 | 3.9 / 19.5 |

یک سوال معمولی با ۱۰۰۰ توکن ورودی و ۵۰۰ توکن خروجی روی مدل «سریع» حدود ۳۴۱۲ اعتبار (حدود ۰٫۰۰۳۴ دلار) مصرف می‌کند. پس «بسته پایه» با ۲,۰۰۰,۰۰۰ اعتبار تقریباً ۵۸۰ سوال این‌چنینی است.

## بسته‌ها

بسته‌ها در `balance.packs` تعریف می‌شوند:

```yaml
balance:
  enabled: true
  startBalance: 200000        # هدیه ثبت‌نام: $0.20
  display: percent
  packs:
    - id: starter             # شناسه برای API و CLI
      label: 'بسته پایه'       # نامی که کاربر کنار نوار مصرف می‌بیند
      credits: 2000000        # = $2 مصرف با قیمت فروش
      description: 'یادداشت برای ادمین'
```

**قیمت‌گذاری بسته به ریال:** هر بسته معادل `credits ÷ 1,000,000` دلار مصرف با قیمت فروش است، که خودش قیمت OpenRouter × ضریب است. مثلاً با ضریب 1.3، بسته پایه حدود ۱٫۵۴ دلار برای شما هزینه OpenRouter دارد. قیمت ریالی را با نرخ دلار خودتان و حاشیه دلخواه تعیین کنید.

**دادن بسته به کاربر:**
- اعتبار باقی‌مانده کاربر حذف نمی‌شود و به بسته جدید اضافه می‌شود.
- نوار مصرف دوباره از «۰٪» شروع می‌شود، چون مبنای درصد موجودی کاربر درست بعد از دریافت بسته است.
- هر شارژ یک تراکنش `context: pack` در دفتر کل ثبت می‌کند. شارژ با مقدار دلخواه با `context: admin` ثبت می‌شود.

### از طریق API ادمین

حساب ادمین لازم است. اولین حسابی که ثبت‌نام می‌کند ADMIN می‌شود. توکن را از پاسخ `POST /api/auth/login` بردارید.

```bash
# لیست بسته‌ها
curl -H "Authorization: Bearer $TOKEN" https://chat.example.com/api/admin/balance/packs

# دادن بسته
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","packId":"starter"}' \
  https://chat.example.com/api/admin/balance/grant

# مقدار دلخواه به جای بسته (یکی از packId یا credits را بفرستید، نه هر دو)
  -d '{"userId":"<id>","credits":500000}'

# موجودی و درصد مصرف یک کاربر
curl -H "Authorization: Bearer $TOKEN" "https://chat.example.com/api/admin/balance/user?email=user@example.com"
```

| کد خطا | معنی |
|---|---|
| `400 grant_amount_required` / `grant_amount_ambiguous` / `grant_amount_invalid` | مقدار ارسال نشده، هر دو ارسال شده، یا نامعتبر است |
| `400 grant_target_required` / `invalid_user_id` | کاربر مشخص نشده یا شناسه نامعتبر است |
| `404 user_not_found` / `pack_not_found` | کاربر یا بسته پیدا نشد |
| `409 balance_disabled` | `balance.enabled` خاموش است |
| `403` | حساب، دسترسی ادمین (`manage:users`) ندارد |

همین API نقطه اتصال درگاه پرداخت است: بعد از تأیید پرداخت، سرور شما `grant` را صدا می‌زند.

### از طریق CLI (داخل کانتینر)

در Coolify وارد Terminal سرویس `api` شوید:

```bash
cd /app
npm run grant-pack -- --list
npm run grant-pack -- user@example.com starter
npm run grant-pack -- user@example.com --credits 500000
```

## محدودیت‌های شناخته‌شده

- **هزینه‌های جدا از توکن حساب نمی‌شوند.** OpenRouter برای بعضی مدل‌ها، مثل جستجوی بومی Perplexity، هزینه جداگانه به‌ازای هر درخواست (`web_search`) می‌گیرد. LibreChat فقط توکن را حساب می‌کند، پس این هزینه از حاشیه سود شما کم می‌شود.
- **Embedding فایل‌ها هزینه دارد.** rag_api برای embedding هزینه OpenRouter دارد ولی از کاربر کسر نمی‌شود. با `text-embedding-3-small` این هزینه بسیار کم است.
- **مدل خارج از لیست OpenRouter:** ضریب فقط روی قیمت‌های دریافت‌شده از OpenRouter (یا `tokenConfig` ثابت) اعمال می‌شود. مدلی که در آن لیست نباشد با جدول داخلی LibreChat و بدون ضریب قیمت می‌خورد. با `modelSpecs.enforce: true` کاربر فقط مدل‌های تعریف‌شده را دارد.
- **مسیرهای دیگر مصرف بررسی نشده‌اند.** مسیرهایی مثل خلاصه‌سازی خودکار گفتگو ممکن است از مسیر دیگری قیمت بگیرند.
