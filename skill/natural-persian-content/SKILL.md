---
name: natural-persian-content
display-title: نوشتن محتوای فارسی
description: Writes Persian that reads as if a skilled native writer wrote it, not a translation - posts and captions (اینستاگرام، X، لینکدین), emails, articles, product and ad copy, scripts and messages. Use when the user asks to write, draft or rewrite Persian content (بنویس، متن بساز، کپشن، پست، ایمیل، مقاله). For a full researched article or a Word file, article-writer leads the work.
allowed-tools:
  - persian_normalize
license: MIT
---

# نوشتن محتوای فارسی

## Before writing

Ask one short question only when the answer would change the text a lot (who it is for, where it
is published, or a fact you need). Otherwise use these defaults and do not ask:

- Register: نیمه‌رسمی (the tone of a good Iranian website). Use رسمی for official letters and
  محاوره only when the user writes that way or asks for it.
- Length: short. One idea per sentence.

## Write in Persian, not from English

- Compose the sentence in Persian. Do not carry English word order or idioms across.
  «ما در حال کار کردن روی این هستیم» → «روی آن کار می‌کنیم».
- Prefer a verb to a noun phrase: «بررسی انجام شد» → «بررسی کردیم»؛ «مورد استفاده قرار گرفت» →
  «استفاده شد»؛ «اقدام به ثبت‌نام نمایید» → «ثبت‌نام کنید».
- Plain words over heavy ones: «جهت / به منظور» → «برای»؛ «می‌باشد» → «است»؛ «نمودن» → «کردن»؛
  «لذا» → «پس» (outside formal letters).
- Avoid passive «توسط» chains; say who did it.
- Cut stock phrases: «در دنیای امروز»، «نقش کلیدی»، «بی‌شک»، «در نهایت می‌توان گفت»، «انقلابی»،
  «سفری هیجان‌انگیز».
- In colloquial writing, spell it consistently and correctly: می‌خوام، می‌شه، نمی‌دونم.

## Shape it for where it goes

| Where | Shape |
|---|---|
| اینستاگرام | A first line that makes people stop, short paragraphs, a clear call to action, 3 to 8 hashtags written with underscores (#هوش_مصنوعی), at most three emoji |
| X | Up to 280 characters; a thread numbered ۱/ ۲/ when longer |
| لینکدین | Professional, a first-line hook, short paragraphs, no hashtag wall |
| ایمیل | Subject line, greeting, the request in the first two lines, closing («با احترام» or «ممنونم») |
| مقاله | Title, a short intro that says what the reader gets, headed sections, a short ending |
| تبلیغ و معرفی محصول | The benefit first, then the proof, then the action |

## Facts

Do not invent numbers, prices, quotes, reviews or claims. Leave a clear placeholder instead:
[نام محصول]، [قیمت].

## Finish

Run `persian_normalize` on the final text and return its `text`. Give the content first; add a
line about choices you made only when it helps the user.
