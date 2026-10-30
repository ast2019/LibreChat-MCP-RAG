---
name: persian-orthography
display-title: نگارش و نیم‌فاصله
description: Proofreads Persian text (ویرایش، غلط‌گیری، درست‌نویسی) - the half-space (نیم‌فاصله) in می/نمی، ها، تر/ترین and compounds, Persian ی and ک, punctuation and spacing («»، ؛ ؟), spelling and agreement - without changing meaning or tone. Use when the user asks to fix, correct, proofread or tidy Persian writing.
allowed-tools:
  - persian_normalize
license: MIT
---

# نگارش و نیم‌فاصله

## Pick the mode

Choose from the user's words; default to «ویرایش».

| Mode | When | What changes |
|---|---|---|
| ماشینی | «فقط نیم‌فاصله»، «فقط حروف و فاصله» | Only what `persian_normalize` fixes |
| ویرایش | «ویرایش کن»، «غلط‌هاش رو بگیر» | Spelling, half-spaces, punctuation, agreement, clear typos; words and tone stay |
| بازنویسی روان | «روان‌ترش کن»، «بازنویسی کن» | Also sentence flow and wording, with the same meaning and register |

## Steps

1. Run `persian_normalize` on the user's text. Send text over 20,000 characters in parts.
2. In «ماشینی» mode, return the tool's `text` as is.
3. Otherwise edit the tool's output for the chosen mode, then run `persian_normalize` once more on
   your final text.
4. Return the corrected text first. Then, unless the user asked for the text only, list at most
   five kinds of changes in one short bullet each.

## Rules the tool cannot judge

- Half-space after ه before ‌ای/‌ام/‌اید: خانه‌ای، خسته‌ام، رفته‌اید.
- Comparatives and compounds take a half-space: بزرگ‌تر، هم‌زمان، بی‌نظیر، به‌عنوان، به‌طوری‌که،
  پیش‌بینی، دست‌یابی. The preposition «به» stays separate: به خانه، به من.
- Keep the writer's choice for ezafe after ه (خانهٔ ما / خانه‌ی ما) and use it consistently.
- «ی» and «ئ»: پایین، آیین، مسئله، مسئول.
- Common misspellings: «اطاق» → «اتاق»، «باطری» → «باتری»، «بلیط» → «بلیت»، «ذغال» → «زغال».
- One space after punctuation and none before it. Persian comma «،», question mark «؟» and «».
- Persian digits in Persian prose unless the writer used Latin ones on purpose.

## Do not change

Meaning, facts, numbers, names, quotations, code, links, English terms, or a deliberately
colloquial style («می‌خوام» stays colloquial unless the user asked for formal Persian).
