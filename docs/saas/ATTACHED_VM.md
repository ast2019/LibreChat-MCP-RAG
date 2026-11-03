# Attached VM (ماشین وصل‌شده)

مسیر شبیه **Cursor Cloud / Kiro Cloud** در HiveGPT: یک ماشین واقعی Ubuntu که Agent روی آن فایل می‌خواند، شِل می‌زند، تست می‌کند و کد می‌نویسد.

## دو لایه را قاطی نکنید

| لایه | سرویس | برای چه |
|---|---|---|
| Code Interpreter | `codeapi` + microVM | اجرای امن کد/تحلیل CSV داخل قفس |
| **Attached VM** | `codeapi_bridge` + `@librechat/code` روی VM شما | توسعه واقعی: Git، apt، Docker روی host، تست کامل پروژه |

ساخت **خودکار** VM فقط با دادن لینک گیت (مثل محصول کامل Cursor) در LibreChat نیست؛ اول VM را می‌سازید، بعد وصل می‌کنید. بعد از وصل، Agent همان کارها را روی آن انجام می‌دهد.

## پیش‌نیاز

1. استک Code Interpreter از قبل در compose باشد (`deploy/code-interpreter/`).
2. سرویس **`codeapi_bridge`** سالم باشد.
3. یک دامنهٔ **https://** فقط برای `codeapi_bridge` در Coolify (مثلاً `https://code.example.com`).
4. متغیرها:
   - `LIBRECHAT_CODE_BRIDGE_BASEURL=https://code.example.com/v1`
   - `CODE_BRIDGE_ADMIN_TOKEN` از `SERVICE_HEX_64_CODEBRIDGE` (در compose به `api` داده می‌شود)
5. قبل از عمومی کردن دامنه: `CODEAPI_BRIDGE_LOCAL_MODE=false` و احراز هویت JWT طبق
   [مستندات Code Interpreter](https://www.librechat.ai/docs/configuration/tools/code_interpreter). با `LOCAL_MODE=true` روی اینترنت، هر کسی می‌تواند API را صدا بزند.
6. در `config/librechat.saas.yaml` بلوک `environments` مربوط به `personal-workers` را از حالت توضیح خارج کنید و redeploy کنید.

قابلیت `stateful_code_sessions` و سقف `principalWorkers` (پیش‌فرض ۲ ماشین به ازای هر کاربر) از قبل در yaml هست.

## نصب worker روی VM

راهنمای کوتاه: [`deploy/code-worker/README.md`](../../deploy/code-worker/README.md)

```bash
# روی Ubuntu VM
INSTALL_DOCKER=1 bash deploy/code-worker/install-host.sh
# سپس Connect VM در تنظیمات HiveGPT و:
librechat-code pair "$LIBRECHAT_CODE_BRIDGE_BASEURL" '<one-time-code>'
librechat-code start --environment /etc/librechat-code/environments/primary.yaml
```

Docker را **روی خود VM** نصب کنید (نه داخل کانتینر تو در تو). پروژه‌هایی که `docker compose` دارند روی همان host اجرا می‌شوند.

## جریان کاری شبیه Cursor Cloud

```text
۱) VM ابری (Hetzner/AWS/…) + worker
۲) git clone به /srv/code-workspaces/…
۳) در Agent: Stateful code sessions + محیط attached
۴) در چت: Ask before changes → نصب وابستگی، تست، اصلاح کد
۵) در صورت موفقیت: commit / PR از روی همان VM
```

## امنیت

- Pairing فقط هویت worker را ثابت می‌کند؛ خود VM را sandbox نمی‌کند.
- VM را ایزوله بگیرید؛ secretهای تولید را روی آن نگذارید مگر لازم باشد.
- اول حالت **Ask**؛ Full access فقط روی ماشین‌های مورد اعتماد.
- `codeapi` (sandbox) را عمومی نکنید؛ فقط در صورت نیاز `codeapi_bridge` را با HTTPS و بدون LOCAL_MODE.

## محدودیت فعلی

- Provision خودکار VM از روی URL گیت هنوز پیاده نشده است.
- Skill جدا برای Attached لازم نیست؛ رفتار از ابزارهای workspace/shell می‌آید.
