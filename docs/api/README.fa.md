# راهنمای API برنامه‌نویسی HiveGPT

با این API از کد خودتان، از VS Code یا از ابزارهای خط فرمان به مدل‌های HiveGPT وصل می‌شوید: هم مدل‌های ابری منو (Claude، ChatGPT، Gemini و بقیه) و هم مدل‌های لوکال امن که روی سرورهای خود ما اجرا می‌شوند. API با قالب OpenAI کار می‌کند، پس هر کتابخانه یا ابزاری که با OpenAI کار می‌کند، با تغییر نشانی پایه و کلید با HiveGPT هم کار می‌کند.

مرجع کامل همه‌ی مسیرها، فیلدها و خطاها روی خود سایت است:

- مرجع تعاملی: `https://hivelink.co/api/docs`
- سند OpenAPI: `https://hivelink.co/api/openapi.json`

## ۱. گرفتن دسترسی و کلید

1. دسترسی API برای حساب شما باید روشن باشد. یکی از این سه راه آن را روشن می‌کند:
   - مدیر در «پنل مدیریت ← مدیریت کاربران» دسترسی API را برای شما روشن کند؛
   - بسته‌ی فعلی شما شامل API باشد («پنل مدیریت ← بسته‌ها»)؛
   - نقش شما در «دسترسی کاربران» اجازه‌ی API داشته باشد.
2. در «تنظیمات ← کلیدهای API» یک کلید بسازید. کلید فقط یک بار نمایش داده می‌شود؛ آن را جای امنی نگه دارید.
3. هزینه‌ی هر درخواست با همان قیمت‌های چت از اعتبار شما کم می‌شود. بدون اعتبار، درخواست با خطای 402 رد می‌شود.

## ۲. نشانی پایه و احراز هویت

```
https://hivelink.co/api/agents/v1
```

کلید را در سرآیند `Authorization` بفرستید:

```
Authorization: Bearer <کلید شما>
```

## ۳. فهرست مدل‌ها

```bash
curl https://hivelink.co/api/agents/v1/models \
  -H "Authorization: Bearer $HIVEGPT_API_KEY"
```

مقدار `id` هر مدل را در فیلد `model` بفرستید (مثلاً `smart`). این فهرست فقط مدل‌هایی را دارد که حساب شما اجازه‌ی استفاده از آن‌ها را دارد، و ایجنت‌هایی که با شما به اشتراک گذاشته شده‌اند.

- `provider`: گروه مدل در منو، مثل `Claude` یا `Qwen`.
- `privacy: "local"`: مدل روی سرورهای خود ما اجرا می‌شود و چیزی که برایش می‌فرستید بیرون نمی‌رود.
- `privacy: "private"`: مدل از سرورهایی استفاده می‌کند که داده نگه نمی‌دارند.

نام خام مدل‌ها (مثلاً `anthropic/claude-sonnet-...` یا `gpt-4o`) پذیرفته نمی‌شود و خطای 404 می‌گیرد؛ همیشه از `id` همین فهرست استفاده کنید.

## ۴. چت (Chat Completions)

```bash
curl https://hivelink.co/api/agents/v1/chat/completions \
  -H "Authorization: Bearer $HIVEGPT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "smart", "messages": [{"role": "user", "content": "سلام"}]}'
```

با Python:

```python
from openai import OpenAI

client = OpenAI(base_url="https://hivelink.co/api/agents/v1", api_key="YOUR_API_KEY")
reply = client.chat.completions.create(
    model="smart",
    messages=[{"role": "user", "content": "سلام"}],
)
print(reply.choices[0].message.content)
```

- **استریم:** با `"stream": true` پاسخ به شکل Server-Sent Events می‌آید (`chat.completion.chunk`) و با `data: [DONE]` تمام می‌شود. آخرین تکه `usage` را دارد.
- **استدلال مدل:** اگر مدل استدلال داشته باشد، در `delta.reasoning` (استریم) یا `message.reasoning` می‌آید.
- **تصویر ورودی:** در `content` می‌توانید بخش `image_url` بفرستید.
- **ادامه‌ی گفتگوی ذخیره‌شده:** به‌جای فرستادن کل تاریخچه می‌توانید `conversation_id` و `parent_message_id` بفرستید.

## ۵. ابزارها (function calling)

برنامه‌ی شما ابزارهایش را در `tools` می‌فرستد و خودش آن‌ها را اجرا می‌کند. همین چیزی است که افزونه‌های برنامه‌نویسی برای خواندن و نوشتن فایل و اجرای دستور لازم دارند.

```json
{
  "model": "smart",
  "messages": [{ "role": "user", "content": "فایل src/app.ts را باز کن" }],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Read a file of the workspace",
        "parameters": {
          "type": "object",
          "properties": { "path": { "type": "string" } },
          "required": ["path"]
        }
      }
    }
  ]
}
```

وقتی مدل ابزاری را صدا بزند، پاسخ با `finish_reason: "tool_calls"` تمام می‌شود و فراخوانی‌ها در `message.tool_calls` (یا در استریم، `delta.tool_calls`) می‌آیند:

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_1",
      "type": "function",
      "function": { "name": "read_file", "arguments": "{\"path\":\"src/app.ts\"}" }
    }
  ]
}
```

برنامه‌ی شما ابزار را اجرا می‌کند و درخواست بعدی را با همان پیام assistant و یک پیام `tool` برای هر فراخوانی می‌فرستد:

```json
{ "role": "tool", "tool_call_id": "call_1", "content": "export const answer = 42;" }
```

نکته‌ها:

- وقتی `tools` می‌فرستید، مدل فقط ابزارهای شما را می‌بیند و ابزارهای سمت سرور (مثل جست‌وجوی وب) برای آن درخواست خاموش است.
- `tool_choice: "none"` هیچ ابزاری نمی‌فرستد. `auto` (پیش‌فرض)، `required` و انتخاب یک ابزار مشخص، همه‌ی ابزارها را می‌فرستند؛ `required` و ابزار مشخص از مدل خواسته می‌شوند، ولی همه‌ی مدل‌ها مجبور به رعایتشان نیستند.
- هر پیام `tool` باید به فراخوانی پیام assistant قبل از خودش جواب بدهد. فراخوانی‌ای که جوابی ندارد از تاریخچه کنار گذاشته می‌شود.
- حداکثر ۱۲۸ ابزار در هر درخواست؛ نام ابزار ۱ تا ۶۴ حرف انگلیسی، عدد، `_` یا `-`.
- مدلی انتخاب کنید که فراخوانی ابزار را پشتیبانی کند (مدل‌های Claude، ChatGPT، Gemini، Qwen و GLM پشتیبانی می‌کنند). مدل‌های لوکال بسته به مدل ممکن است ابزار را خوب صدا نزنند.

## ۶. برنامه‌نویسی در VS Code

### Continue

افزونه‌ی Continue را نصب کنید، از پنل Continue چرخ‌دنده ← Configure را بزنید و این را در `config.yaml` بگذارید:

```yaml
name: HiveGPT
version: 1.0.0
schema: v1
models:
  - name: HiveGPT smart
    provider: openai
    model: smart
    apiBase: https://hivelink.co/api/agents/v1
    apiKey: YOUR_API_KEY
    roles: [chat, edit, apply]
    capabilities: [tool_use]
```

`capabilities: [tool_use]` حالت Agent را روشن می‌کند (خواندن و ویرایش فایل و اجرای دستور). برای مدل‌های دیگر همین بلوک را با `model` دیگری تکرار کنید.

### Cline و Roo Code

در تنظیمات افزونه، API Provider را «OpenAI Compatible» بگذارید:

- Base URL: `https://hivelink.co/api/agents/v1`
- API Key: کلید شما
- Model ID: یکی از `id`های `GET /models`، مثلاً `smart`

## ۷. ابزارهای خط فرمان (CLI)

### OpenCode

در `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "hivegpt": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "HiveGPT",
      "options": {
        "baseURL": "https://hivelink.co/api/agents/v1",
        "apiKey": "{env:HIVEGPT_API_KEY}"
      },
      "models": { "smart": { "name": "HiveGPT smart" } }
    }
  }
}
```

### Aider

```bash
export OPENAI_API_BASE=https://hivelink.co/api/agents/v1
export OPENAI_API_KEY=YOUR_API_KEY
aider --model openai/smart
```

### Codex CLI

نسخه‌های فعلی Codex CLI فقط با Responses API کار می‌کنند و ابزارهای خاص خودشان (مثل `apply_patch`) را می‌فرستند که این API هنوز پشتیبانی نمی‌کند. فعلاً Continue، Cline، Roo Code، OpenCode یا Aider را به کار ببرید.

## ۸. Responses API

`POST /responses` قالب Open Responses را دارد: `input` (متن یا آیتم‌ها)، `instructions`، `tools` (به شکل `{"type": "function", "name", "parameters"}`)، `stream` و `previous_response_id` (برای پاسخی که با `store: true` ذخیره شده). فراخوانی ابزار به شکل آیتم `function_call` برمی‌گردد و برنامه‌ی شما آن را همراه `function_call_output` در `input` درخواست بعدی می‌فرستد. جزئیات در مرجع تعاملی هست.

## ۹. محدودیت‌ها

- **سقف درخواست:** برای هر حساب ۶۰ درخواست مدل در دقیقه (همه‌ی کلیدها روی هم). بیشتر از آن خطای 429 با سرآیند `Retry-After` می‌گیرد؛ افزونه‌ها و CLIها خودشان صبر می‌کنند و دوباره می‌فرستند.
- **ساخت تصویر، ویدیو و صدا** در API نیست؛ برای آن‌ها از خود سایت استفاده کنید.
- **مدل‌هایی که از چند ایجنت ساخته شده‌اند** ابزار فراخواننده را نمی‌پذیرند (خطای 400)؛ برای برنامه‌نویسی یک مدل ساده انتخاب کنید.

## ۱۰. خطاها

همه‌ی خطاها قالب OpenAI را دارند: `{"error": {"message", "type", "code", "param"}}`.

| کد HTTP | `code` | معنی و کار لازم |
|---|---|---|
| 400 | — | درخواست نادرست؛ پیام خطا می‌گوید کدام فیلد |
| 401 | `missing_api_key`، `invalid_api_key` | کلید فرستاده نشده یا نامعتبر است |
| 402 | `insufficient_balance` | اعتبار تمام شده؛ بسته بخرید |
| 403 | `api_access_disabled` | مدیر API را برای حساب شما خاموش کرده |
| 403 | `api_not_in_pack` | بسته‌ی فعلی شما شامل API نیست |
| 403 | — | نقش شما اجازه‌ی API ندارد، یا ایجنت با شما به اشتراک گذاشته نشده؛ از مدیر بخواهید |
| 404 | `model_not_found` | این مدل نیست؛ نامی از `GET /models` بفرستید |
| 409 | `account_deletion_in_progress` | حساب در حال حذف است |
| 429 | `rate_limit_exceeded` | سقف درخواست در دقیقه پر شده؛ به اندازه‌ی `Retry-After` صبر کنید |
| 500 | — | خطای سرور؛ دوباره تلاش کنید |

اگر خطا بعد از شروع استریم پیش بیاید، به شکل آخرین تکه‌ی متن و بعد `[DONE]` می‌آید.

## ۱۱. امنیت کلید

- کلید را در کد یا مخزن git نگذارید؛ در متغیر محیطی (مثلاً `HIVEGPT_API_KEY`) نگه دارید.
- اگر کلید لو رفت، در «تنظیمات ← کلیدهای API» حذفش کنید و کلید تازه بسازید.
- هر کسی کلید شما را داشته باشد، به‌جای شما و از اعتبار شما درخواست می‌فرستد.
