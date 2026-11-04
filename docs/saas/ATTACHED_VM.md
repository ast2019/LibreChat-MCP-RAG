# Attached VM (ماشین وصل‌شده)

مسیر شبیه **Cursor Cloud / Kiro Cloud** در HiveGPT: یک ماشین واقعی Ubuntu که Agent روی آن فایل می‌خواند، شِل می‌زند، تست می‌کند و کد می‌نویسد.

## کدام سرویس کجاست

| لایه | سرویس | برای چه |
|---|---|---|
| Code Interpreter | خاموش | قفس microVM روی سرور Coolify نیست و `/dev/kvm` داده نمی‌شود |
| **Attached VM** | `codeapi_bridge` + `@librechat/code` روی VM شما | توسعه واقعی: Git، apt، Docker روی host، تست کامل پروژه |

ساخت **خودکار** VM فقط با دادن لینک گیت (مثل محصول کامل Cursor) در LibreChat نیست؛ اول VM را می‌سازید، بعد وصل می‌کنید. بعد از وصل، Agent همان کارها را روی آن انجام می‌دهد.

## پیش‌نیاز

1. سرویس **`codeapi_bridge`** در `docker-compose.yml` باشد و healthy شود. قفس Code Interpreter روی این سرور نیست و `/dev/kvm` داده نمی‌شود.
2. در Coolify فقط برای `codeapi_bridge` دامنه بگذارید: `http://code.aichat.hivelink.co:3114`. پورت ۳۱۱۴ داخل کانتینر است و روی میزبان منتشر نمی‌شود. ابر آروان TLS را تمام می‌کند و به پورت ۸۰ آی‌پی سرور Coolify فوروارد می‌کند، نه به ۳۱۱۴ و نه به آی‌پی ماشین worker. `code_jwt` و بقیهٔ سرویس‌های کد دامنه نمی‌گیرند.
3. `LIBRECHAT_CODE_BRIDGE_BASEURL` پیش‌فرض `https://code.aichat.hivelink.co/v1` است. `CODE_BRIDGE_ADMIN_TOKEN` از `SERVICE_HEX_64_CODEBRIDGE` می‌آید و Coolify آن را می‌سازد.
4. `CODEAPI_BRIDGE_LOCAL_MODE` پیش‌فرض `false` است و حالت احراز هویت `paired` است. آن را `true` نکنید وگرنه API روی اینترنت بدون احراز هویت می‌ماند.
5. بلوک `personal-workers` در `config/librechat.saas.yaml` روشن است. `default: true` ندارد، چون صفحهٔ کنترل pairing نباید محیط پیش‌فرض اجرا باشد و با آن خط `api` بالا نمی‌آید.

قابلیت `stateful_code_sessions` و سقف `principalWorkers` (پیش‌فرض ۲ ماشین به ازای هر کاربر) از قبل در yaml هست.

## نصب worker روی VM

راهنمای کوتاه: [`deploy/code-worker/README.md`](../../deploy/code-worker/README.md)

```bash
# روی Ubuntu VM
INSTALL_DOCKER=1 bash deploy/code-worker/install-host.sh
# سپس Connect VM در تنظیمات HiveGPT و دستور pair/run نشان‌داده‌شده را بزنید، یا:
librechat-code pair "$LIBRECHAT_CODE_BRIDGE_BASEURL" '<one-time-code>' --worker-id '<worker-id>'
LIBRECHAT_CODE_WORKER_ID='<worker-id>' librechat-code run \
  --default-workspace \
  --allow-workspace-writes \
  --allow-workspace-commands \
  --command-policy-preset trusted-vm
```

Docker را **روی خود VM** نصب کنید (نه داخل کانتینر تو در تو). پروژه‌هایی که `docker compose` دارند روی همان host اجرا می‌شوند.

## جریان کاری شبیه Cursor Cloud

در UI واقعی HiveGPT (نه چت مدل معمولی «ادمین»):

1. نوار کناری چپ → آیکون ربات (**سازنده ایجنت**). فقط نقشی که `AGENTS.create` دارد این را می‌بیند؛ در کانفیگ SaaS ساخت ایجنت برای USER خاموش است و ادمین می‌سازد.
2. بالای پنل → **ایجاد ایجنت جدید**؛ نام و مدل را بگذار.
3. بخش **ابزارها** → **افزودن ابزارها** → در **کتابخانه ابزار** گزینهٔ **اجرای کد** را اضافه کن.
4. روی همان ردیف **اجرای کد** بزن تا دیالوگ تنظیمات باز شود → **نشست‌های کد پایدار** را روشن کن → **محیط اجرا** را روی **ماشین شخصی (Attached VM)** بگذار → ذخیره / ایجاد.
5. در چت، از انتخابگر مدل بالای صفحه endpoint **ایجنت‌ها** و همان ایجنت را انتخاب کن (مدل «ادمین» کافی نیست).
6. بالای جعبهٔ پیام نوار **دستگاه** می‌آید؛ ماشین جفت‌شده را انتخاب کن و بعد عادی پیام بده.

```text
۱) VM ابری (Hetzner/AWS/…) + worker
۲) git clone به /srv/code-workspaces/…
۳) در Agent: اجرای کد + نشست‌های کد پایدار + محیط attached
۴) در چت: Ask before changes → نصب وابستگی، تست، اصلاح کد
۵) در صورت موفقیت: commit / PR از روی همان VM
```

## امنیت

- Pairing فقط هویت worker را ثابت می‌کند؛ خود VM را sandbox نمی‌کند.
- VM را ایزوله بگیرید؛ secretهای تولید را روی آن نگذارید مگر لازم باشد.
- اول حالت **Ask**؛ Full access فقط روی ماشین‌های مورد اعتماد.
- `codeapi` (sandbox) را عمومی نکنید؛ فقط در صورت نیاز `codeapi_bridge` را با HTTPS و بدون LOCAL_MODE.

## خطای رایج: `apply-seccomp` / `setgroups` / `CAP_SYS_ADMIN`

اگر pairing موفق است ولی هر دستور شِل (حتی `echo` یا `git --version`) با این خطا تمام می‌شود:

```text
apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied
```

علت رایج‌تر این است که worker با policy پیش‌فرض `restricted` بالا آمده، نه `trusted-vm`. روی Ubuntu، helperِ `apply-seccomp` داخل bubblewrap معمولاً به `CAP_SYS_ADMIN` در nested userns نمی‌رسد (AppArmor / bounding set). presetِ `trusted-vm` همان کاری را می‌کند که Anthropic برای این حالت پیشنهاد می‌دهد: `allowAllUnixSockets: true` تا آن helper از زنجیره حذف شود، در حالی که قوانین فایل‌سیستم و masking اعتبارنامهٔ SRT می‌مانند. اتصال VM و ابزارهای فایل ممکن است هنوز جواب بدهند؛ فقط اجرای دستور می‌شکند. پیام‌های `Workspace tool request invalid` بعد از شکست clone معمولاً ثانویه‌اند (مسیر/ریپو وجود ندارد).

روی همان VM، worker را با preset درست دوباره اجرا کنید:

```bash
# اگر systemd دارید، واحد Settings از قبل trusted-vm دارد:
sudo systemctl restart librechat-code.service

# یا foreground (همان worker-id جفت‌شده):
LIBRECHAT_CODE_WORKER_ID='<worker-id>' librechat-code run \
  --default-workspace \
  --allow-workspace-writes \
  --allow-workspace-commands \
  --command-policy-preset trusted-vm
```

در UI وضعیت محیط باید چیزی شبیه `anthropic-srt:trusted-vm` نشان بدهد، نه فقط `anthropic-srt` / `native-srt`.

دفاع اضافی روی Ubuntu 24.04+ (و برای policyِ `restricted`):

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-librechat-code-userns.conf
```

`deploy/code-worker/install-host.sh` همین sysctl را اعمال می‌کند و `bwrap` را تست می‌کند. اگر میزبان کانتینر است نه VM واقعی، nested userns باید از سمت runtime بیرونی مجاز باشد.

## محدودیت فعلی

- Provision خودکار VM از روی URL گیت هنوز پیاده نشده است.
- Skill جدا برای Attached لازم نیست؛ رفتار از ابزارهای workspace/shell می‌آید.
