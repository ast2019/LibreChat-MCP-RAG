# Attached VM (ماشین وصل‌شده)

مسیر شبیه **Cursor Cloud / Kiro Cloud** در HiveGPT: یک ماشین واقعی Ubuntu که Agent روی آن فایل می‌خواند، شِل می‌زند، تست می‌کند و کد می‌نویسد.

## دو لایه را قاطی نکنید

| لایه | سرویس | برای چه |
|---|---|---|
| Code Interpreter | `codeapi` + microVM | اجرای امن کد/تحلیل CSV داخل قفس |
| **Attached VM** | `codeapi_bridge` + `@librechat/code` روی VM شما | توسعه واقعی: Git، apt، Docker روی host، تست کامل پروژه |

ساخت **خودکار** VM فقط با دادن لینک گیت (مثل محصول کامل Cursor) در LibreChat نیست؛ اول VM را می‌سازید، بعد وصل می‌کنید. بعد از وصل، Agent همان کارها را روی آن انجام می‌دهد.

## پیش‌نیاز

1. سرویس **`codeapi_bridge`** در `docker-compose.yml` باشد و healthy شود. قفس Code Interpreter روی این سرور نیست و `/dev/kvm` داده نمی‌شود.
2. در Coolify فقط برای `codeapi_bridge` دامنه بگذارید: `https://code.aichat.hivelink.co:3114`. پورت ۳۱۱۴ داخل کانتینر است. ابر آروان به پورت ۸۰ آی‌پی سرور Coolify فوروارد می‌کند، نه به ۳۱۱۴ و نه به آی‌پی ماشین worker.
3. `LIBRECHAT_CODE_BRIDGE_BASEURL` پیش‌فرض `https://code.aichat.hivelink.co/v1` است. `CODE_BRIDGE_ADMIN_TOKEN` از `SERVICE_HEX_64_CODEBRIDGE` می‌آید و Coolify آن را می‌سازد.
4. `CODEAPI_BRIDGE_LOCAL_MODE` پیش‌فرض `false` است و حالت احراز هویت `paired` است. آن را `true` نکنید وگرنه API روی اینترنت بدون احراز هویت می‌ماند.
5. بلوک `personal-workers` در `config/librechat.saas.yaml` روشن است. `default: true` ندارد، چون صفحهٔ کنترل pairing نباید محیط پیش‌فرض اجرا باشد و با آن خط `api` بالا نمی‌آید.

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
