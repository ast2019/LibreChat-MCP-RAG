---
name: clip-builder
display-title: کلیپ‌ساز
description: Plans a topic-aware motion-graphics clip as a storyboard (kinetic titles, animated stats, charts, icons, steps, timelines, comparisons, photos, captions, narration) and renders it in the background with create_remotion_clip. Use for کلیپ، ریلز، موشن‌گرافیک، ویدیوی توضیحی.
disable-model-invocation: true
allowed-tools:
  - create_remotion_clip
license: MIT
---

# کلیپ‌ساز

Start this skill from the composer's **«ساختن»** row (کلیپ‌ساز), which equips
`create_remotion_clip`. Without the tool, do not write Remotion code or invent links: ask the
user to turn on کلیپ‌ساز.

The clip is programmatic motion graphics, not a generative video model: every scene is drawn
from its own fields. So the visuals are only as good as the storyboard. Take the content from
the user's topic: real numbers become `stat` and `chart` scenes, a process becomes `steps`, a
history becomes `timeline`, a choice becomes `compare`, things and ideas get Tabler icons.

## The flow (one step per message)

1. **Brief (wait).** Ask what is still unknown with `ask_user_question` (four questions per
   form at most; mark a `recommended` answer):
   - purpose and audience (explain, sell, announce, teach; who watches);
   - length: 15 / 30 / 60 seconds (recommended 30; the deployment limit is in the context);
   - aspect ratio: 9:16 Reels/Shorts (recommended), 4:5 feed, 1:1, 16:9 YouTube;
   - voice: narration with captions (recommended), music only, or the user's own audio file.
     With narration, list the narrator voices from the context by their label (not the id) and
     let the user pick; say which ones are "charged".
   Ask about images only when the topic needs photos: the user's attached or generated images,
   AI images or stock photos (offer only the sources the context lists), or icons only.
2. **Outline (wait).** Show a numbered table: scene, type, on-screen content (numbers and
   labels included), narration line, seconds. Name the theme and music. Get an OK or edits.
   Check facts and numbers before you put them on screen; say where a number comes from.
3. **Optional preview.** If the user wants to see the look first, call with `preview: true`:
   key frames come back as images. Then ask before the full render.
4. **Render once.** Call `create_remotion_clip` once with the full storyboard. It answers at
   once with a progress card link; put that link in your reply. The video replaces the card when
   it is ready. Never call it again on your own: if it reports an error, a busy worker or a clip
   already rendering, tell the user and ask. Validation errors list exact fields: fix those and
   call again.
5. **Changes.** Edit the storyboard and call again with `version` + 1.

## Writing the storyboard

- Open with a `hook` (3-5 s, 4-9 words, one or two `emphasis` words). End with `cta` or `logo`.
- One idea per scene, 3-8 s each. On-screen text is short: headlines up to about 9 words,
  labels 1-3 words. The narration carries the detail, not the screen.
- Narration (with `audio.mode: "tts"`): one or two short sentences per scene, about 13
  Persian or 15 English characters per second. Scenes stretch to fit their narration, so the
  total must stay under the limit. Persian narration: write numbers as words when they read
  better («سی درصد»), and on screen use digits («۳۰٪»).
- Voice choice: pass the chosen voice's id from the context as `audio.voice`; with no
  `audio.voice` the first voice for the clip language is used (Edge, free). Voices marked
  "charged" are made by an AI speech model, one call per narrated scene, and are charged
  like AI images: the call is refused at once, with nothing built or charged, when the credit
  does not cover it. An unknown id is rejected with the list of valid ids. To compare voices,
  render two short clips (a few seconds each) with different `audio.voice` values, or play
  `generate_speech` samples if that tool is offered; do not guess what a voice sounds like.
- Persian copy: no Arabic vowel marks; real half-spaces (ZWNJ) in «می‌شود», «تجدیدپذیر‌ها»;
  `lang: "fa"` gives right-to-left layout, Persian digits and the Vazirmatn face.
- Vary transitions (`fade`, `slide`, `wipe`, `flip`, `clock-wipe`); keep `fade` for calm topics.
- Icons: Tabler names in kebab-case (https://tabler.io/icons), e.g. `bolt`, `solar-panel`,
  `windmill`, `droplet`, `leaf`, `atom`, `chart-bar`, `users`, `school`, `heart`, `rocket`,
  `shield-check`, `clock`, `world`, `building-factory`, `car`, `plane`, `brain`, `robot`,
  `coin`, `trending-up`. An unknown name shows a neutral sparkle and the result says so.

## Scene types

| type | use it for | fields |
| --- | --- | --- |
| `hook` | kinetic title | `headline`, `subline?`, `kicker?`, `emphasis?`, `icon?` |
| `stat` | one big number, counted up (a `%` suffix draws a ring) | `value`, `label`, `prefix?`, `suffix?`, `decimals?`, `caption?`, `icon?` |
| `chart` | bar, line, pie or donut from data | `chart`, `data[{label,value}]` (2-8), `title?`, `unit?`, `highlight?`, `caption?` |
| `icons` | 2-6 items as a grid or a list | `items[{icon,label,detail?}]`, `layout?`, `title?` |
| `steps` | a process, 2-5 steps | `steps[{title,detail?,icon?}]`, `title?` |
| `timeline` | dated events, 2-6 | `events[{date,title,detail?}]`, `title?` |
| `compare` | A vs B | `left{label,points[],icon?}`, `right{…}`, `title?`, `verdict?` |
| `quote` | a quotation | `quote`, `author?`, `role?` |
| `image` | full-screen photo, Ken Burns + parallax | `image`, `headline?`, `caption?`, `motion?` |
| `split` | text beside a photo or a large icon | `headline`, `body?`, `bullets?`, `image?` or `icon?`, `side?` |
| `list` | title and 1-6 bullets | `title`, `bullets`, `icon?` |
| `location` | a place, without a map | `place`, `region?`, `detail?`, `label?`, `icon?` |
| `cta` | the call to action | `headline`, `action?`, `url?`, `handle?` |
| `logo` | logo reveal | `image?` (logo file), `text?`, `tagline?` |

Images: `{ "source": "file", "file_id": "…" }` (attached, or a `generated_image_id` from this
chat), `{ "source": "ai", "prompt": "…" }` (only when offered; charged like the image tool,
tell the user first), `{ "source": "stock", "query": "…" }` (only when offered; Pexels, credited
on screen). Without photos, prefer icons and data scenes.

## Themes and music

`midnight` (default, deep navy, mint and violet), `aurora` (dark, green and purple),
`daylight` (light, corporate and teaching), `sunset` (warm), `editorial` (paper and red, news),
`neon` (black with a cyan grid, tech). `brand_color` sets the accent.
Music: `ambient` (calm), `pulse` (upbeat), `cinematic` (slow swell), or `none`; it ducks under
the narration.

## Honest limits

- Motion graphics from data, text, icons and photos; no characters, lip-sync or filmed footage.
- One clip renders at a time per user; a 60 s clip takes a few minutes.
- The clip itself costs nothing beyond the chat's tokens; AI images are charged like the image
  tool.
