---
name: slide-builder
display-title: پاورپوینت‌ساز
description: Plans and builds a professional, editable PowerPoint deck - right to left in Vazirmatn, with native charts, the user's logo and brand color, pictures when wanted and speaker notes. Also turns an article, a text or an uploaded document into slides (پاورپوینت، اسلاید، ارائه، پرزنتیشن). Use when the user wants a presentation or slides.
allowed-tools:
  - create_presentation
license: MIT
---

# پاورپوینت‌ساز

## The flow

Go one step per message and wait where a step says so.

1. **Brief (wait).** Ask only what is still unknown. When `ask_user_question` is available, ask
   with it, not in text: at most four questions in one call, in the order below, each with 2 to 5
   short options in the user's language and `recommended` set to the default; whatever you did
   not ask takes its default, named in one line when you go on. Without the tool, ask in one
   message, each item with a default the user can accept with «خوب است»:
   - topic and audience, and what the audience should do or know afterwards
   - how long the talk is, or how many slides; about one slide per minute when only the length
     is known
   - style: ساده (`minimal`, default)، رسمی (`corporate`)، آموزشی (`education`)، تیره (`dark`)،
     رنگارنگ (`vibrant`)
   - a logo: the user attaches it to a message; the deck then takes its color
   - pictures: none by default; generated pictures only when the user wants them, or their own
     pictures attached to a message
   When the user gives a text, an article from this chat or a document, take the topic from it
   and ask only about length and style.
2. **Outline (wait).** One line per slide: its number, layout and what it says. Start with
   `title`, end with `closing`, and put a `section` slide between parts of a long deck. Ask the
   user to approve or change it; when `ask_user_question` is available, one question with
   «تأیید طرح اسلایدها» and «تغییر می‌خواهم» after the outline in the message.
3. **Build.** Call `create_presentation` with every slide (see «Slides that work»), then tell
   the user in two or three lines what the deck has, and that it uses the free Vazirmatn font,
   which they install for PowerPoint to show it as designed; Google Slides has it built in.

## Slides that work

- One idea per slide. A title that says the point, not a topic: «فروش ۴۰٪ رشد کرد» rather than
  «فروش».
- At most six bullets of at most about twelve words. Details go in `notes`, which are what the
  presenter says.
- Pick the layout from the content:

| Content | Layout |
|---|---|
| The topics of the talk | `agenda` with `items` |
| Points | `bullets` |
| Two sides, before and after, option A and B | `comparison`, or `two_column` |
| Steps or dates | `timeline` with up to six `items` |
| Two to four key numbers | `stats`, the number as `label` («۴۵٪») and its meaning as `text` |
| Numbers over time or by category | `chart` (column, bar, line, area, pie, doughnut), with up to three bullets beside it |
| Rows of facts | `table`, at most eight rows |
| A strong sentence | `quote` |
| A picture with points | `image`; one large picture: `image_full` |

- Text from the user, an article or a document: keep the key points and every number on the
  slides, and the explanation in the notes.
- Images: a generated picture by its `generated_image_id`; a picture or logo the user attached
  to this message by the id the tool lists. Never take images from the web.
- `version`: 1 for the first deck, then one more for each new deck in this chat.

## Changes after delivery

- «۵ اسلاید دیگر درباره‌ی ... اضافه کن», «اسلاید ۴ را دو تا کن», «اسلاید ۶ را حذف کن»,
  «ترتیب را عوض کن», «عکس اسلاید ۳ را عوض کن»: change only those slides and keep the others as
  they were.
- A new picture comes from a new description, or the picture the user attaches now.
- Then build the deck again with every slide and the next `version`, and tell the user the
  earlier versions stay in «خروجی‌های این گفتگو».
- When the tool reports crowded slides, offer to shorten them or split each into two.
