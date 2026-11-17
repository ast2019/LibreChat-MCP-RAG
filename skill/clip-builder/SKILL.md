---
name: clip-builder
display-title: کلیپ‌ساز
description: Plans and builds short MP4s on the HiveGPT Remotion worker — brand text slides or full Claude animation-style films (comic, chalkboard, claymation, synthwave, ukiyo-e / sumi, brick toy, …). Use for کلیپ، ریلز، استایل انیمیشن.
allowed-tools:
  - create_remotion_clip
license: MIT
---

# کلیپ‌ساز

## Two render modes

1. **Brand slides** — themes `brand-dark`, `brand-light`, `ugc`: title / bullets / closing text
   cards (up to ۳۰s, 9:16 or 16:9).
2. **Style films** — every other theme: a full Remotion animation (SVG/canvas), based on the open
   [animation-styles](https://github.com/deenukhan/animation-styles) pack plus HiveGPT extras
   (Dan Koe, Synthwave, Glow Sketch, ZackD, Noir Comic, …). Native size 1080×1350 (~۵ ثانیه)
   with brand + caption overlay from the scene text. Same pour-story timing; the look is the style.

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

Style films (full motion):
`comic-art`, `cgi-motion`, `lego`, `chalkboard`, `pixel-art`, `flat-vector`, `zackd-films`,
`glow-sketch`, `ps2`, `dan-koe`, `woodblock-print`, `noir-comic`, `cartoon-1930s`, `brick-toy`,
`clay-diorama`, `crt-vector`, `knitted-puppet`, `sumi-ink`, `isometric`, `paper-cut`,
`data-chart-3d`, `synthwave`, `explainer-3d`, `maths-diagram`, `cartoon-explainer`,
`domino-reveal`, `glow-atom`, `blueprint`, `mosaic`, `watercolor`, `threejs-3d`, `claymation`.

Aliases: `neon-synth` → `synthwave`, `paper-cutout` → `paper-cut`, `ink-wash` → `sumi-ink`.

## Honest limits

- Style films redraw a fixed motion story (object pours → container fills → aftermath) in the
  chosen look, with your captions on top. They are not After Effects templates and not lip-synced
  characters.
- Claymation / brick / low-poly looks are code-rendered imitations (same as upstream), not real 3D
  clay or branded toys.
- Building a clip does not add a separate fee beyond conversation tokens.
