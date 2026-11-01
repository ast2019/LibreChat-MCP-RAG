---
name: article-writer
display-title: ویزارد مقاله
description: Writes a professional article step by step - brief, research, an outline the user approves, the full text - and delivers it as an editable Word file. Blog and SEO posts, academic and student papers, news reports, how-to guides and product articles (مقاله، مقاله‌ی سئو، مقاله‌ی علمی، گزارش، فایل ورد). Use when the user wants a full article, a long report or a Word document.
allowed-tools:
  - create_word_document
license: MIT
---

# ویزارد مقاله

## The flow

Go one step per message and wait where a step says so. Keep your own messages short; the article
is the long part.

1. **Brief (wait).** Ask only what is still unknown and would change the article. The list, in
   order of importance:
   - type: وبلاگ و سئو، علمی و دانشجویی، خبری و گزارش، آموزشی، معرفی محصول
   - audience and goal
   - tone: رسمی، نیمه‌رسمی (default)، صمیمی
   - length in words: blog 1200 to 1800, paper 2500 to 4000, news 600 to 900
   - the main keyword, for blog and SEO only
   - sources: always for academic and news; ask for the others
   - images: none by default; a generated picture only when the user wants one, or their own
     picture attached to a message
   When `ask_user_question` is available, ask with it, not in text: at most four questions in
   one call, the four that change the article most, each with 2 to 5 short options in the
   user's language and `recommended` set to the default. Ask nothing else in that message.
   Whatever you did not ask takes its default; name those defaults in one line when you go on,
   so the user can change them. Call it a second time only when an answer opens a question
   that really matters (the keyword after the user picks «وبلاگ و سئو»).
   Without the tool, ask in one message, each item with a default the user can accept with
   «خوب است».
   If the user already said these, go straight to step 2.
2. **Research.** When web search is on, search before writing: 3 to 8 reliable, recent sources,
   official and primary ones first, each with its date. When it is off, say so in one line and
   suggest turning on «جست‌وجوی وب» from the `+` menu, then go on from what you know, without
   citations.
3. **Outline (wait).** Three title options, then the outline: each `##` and `###` heading with one
   line on what it covers, about how many words it gets, the source behind it, and where an
   image or a chart goes. Ask the user to approve or change it: show the outline in the message,
   then, when `ask_user_question` is available, one question with the three titles as options
   (`recommended` on the one you prefer) and one with «تأیید سرفصل‌ها» and «تغییر می‌خواهم»;
   the user types the changes in the form's own answer field.
4. **Write.** The whole article in the chat, in Markdown, following the approved outline.
5. **Word file.** Call `create_word_document` with that text (see «Building the file»), then tell
   the user in two or three lines what the file has.

## Writing

- Persian as a skilled native writer writes it, not a translation: verbs over noun phrases,
  «است» not «می‌باشد», «برای» not «جهت», no «توسط» chains, real half-spaces (می‌شود، کتاب‌ها).
- Open with a lead that tells the reader what they get. One idea per paragraph, two to five
  sentences each, and a subheading every 250 to 350 words.
- Every number, date, quote and claim comes from a source and is cited as [1], [2] in the order
  of the reference list. Never invent a source, a figure, a quote or a link; leave a clear
  placeholder such as [آمار رسمی] when the user must supply it.
- Cut filler: «در دنیای امروز»، «نقش کلیدی»، «بی‌شک»، «در نهایت می‌توان گفت».
- By type:

| Type | It must have |
|---|---|
| وبلاگ و سئو | The keyword in the title, the lead and one heading; short paragraphs; a «پرسش‌های پرتکرار» section with 3 to 5 questions; a call to action at the end |
| علمی و دانشجویی | An abstract, keywords, introduction, body, conclusion; APA references; a neutral, formal tone |
| خبری و گزارش | A lead answering who, what, when, where; the inverted pyramid; quotes with their source |
| آموزشی | Numbered steps, tips, common mistakes and how to avoid them |
| معرفی محصول | The benefit first, then the proof, a comparison table, a call to action |

## Building the file

- `markdown`: the body only, without the title as a heading and without the reference list.
- `summary`: the lead, or the abstract of a paper, in two to four sentences.
- `references`: each source once, in the order the text cites them.
- `seo` for blog and SEO articles: a title of at most 60 characters, a description of 120 to 155
  characters, a Latin slug, 3 to 6 keywords.
- Images: a generated picture as `![caption](image:<generated_image_id>)`; a picture the user
  attached to this message by the id the tool lists. Never take images from the web.
- Charts: when the article compares numbers, a ```chart block with them, so the user gets a
  chart they can edit in Word.
- `style`: `academic` for papers, `modern` for blogs, `formal` for everything else.
- `version`: 1 for the first file, then one more for each new file in this chat.

## Changes after delivery

- Change only what the user asks for, and show only the changed part in the chat:
  - «بخش ۲ را بلندتر کن»: expand that section only.
  - «کل مقاله را به ۲۰۰۰ کلمه برسان»: expand every section in proportion.
  - «لحن را رسمی‌تر کن»: rewrite the tone and keep every fact and source.
  - «عکس بخش ۳ را عوض کن»: generate a new picture from a new description, use the picture the
    user attaches now, or remove it if they ask.
- Then build the file again with the whole updated article and the next `version`. Tell the
  user the earlier versions stay in «خروجی‌های این گفتگو».

## What this skill does not do

It does not publish to the user's site or social accounts, and it does not take pictures from
the web.
