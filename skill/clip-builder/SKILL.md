---
name: clip-builder
display-title: کلیپ‌ساز
description: Plans and builds short MP4s on the HiveGPT Remotion worker — brand text slides or catalog-backed Remotion style films (chalkboard, claymation, brick toy, pixel art, …). Use for کلیپ، ریلز، استایل انیمیشن.
allowed-tools:
  - create_remotion_clip
license: MIT
---

# کلیپ‌ساز

## Two render modes

1. **Brand slides** — themes `brand-dark`, `brand-light`, `ugc`: title / bullets / closing text
   cards (up to ۳۰s, 9:16 or 16:9).
2. **Style films** — themes below: a full Remotion animation from the open
   [animation-styles](https://github.com/deenukhan/animation-styles) catalog. Native size
   1080×1350 (~۵ ثانیه) with brand + caption overlay from the scene text. Only looks that have a
   real catalog film are offered (no placeholder skins).

## The flow

Go one step per message and wait where a step says so.

1. **Brief (wait).** Ask only what is still unknown (use `ask_user_question` when available):
   - topic / one message the clip should leave
   - mode: brand slides vs style film (if style, pick a theme id below)
   - length: for slides ۵ / ۱۵ (default) / ۳۰ ثانیه؛ style films are ~۵s
   - aspect: only for brand slides — ۹:۱۶ (default) or ۱۶:۹
   - audio: none (default) / TTS / uploaded file
2. **Outline (wait).** For slides: one line per scene. For style films: one caption line per beat
   (hook → action → result) from the scenes' headings/bodies; approve before render.
3. **Build.** Call `create_remotion_clip` with `theme` set, then put the tool's markdown into the
   reply so the video card plays. Do not invent download links.

## Theme ids (`theme`)

Brand slides: `brand-dark`, `brand-light`, `ugc`.

Style films (catalog-backed):
`chalkboard`, `pixel-art`, `flat-vector`, `woodblock-print`, `cartoon-1930s`, `brick-toy`,
`paper-cut`, `maths-diagram`, `cartoon-explainer`, `blueprint`, `watercolor`, `claymation`.

Alias: `paper-cutout` → `paper-cut`.

## Honest limits

- Style films redraw a fixed motion story (object pours → container fills → aftermath) in the
  chosen look, with your captions on top. They are not After Effects templates and not lip-synced
  characters.
- Claymation / brick looks are code-rendered imitations (same as upstream), not real 3D clay or
  branded toys.
- Building a clip does not add a separate fee beyond conversation tokens.
