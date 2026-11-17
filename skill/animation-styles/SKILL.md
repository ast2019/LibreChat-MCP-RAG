---
name: animation-styles
display-title: استایل‌های انیمیشن
description: Full Remotion style films on HiveGPT (comic, chalkboard, claymation, synthwave, sumi/ukiyo-e, brick toy, pixel RPG, …). Prefer when the user asks for Claude animation styles or a stylized short silent/ narrated film. Uses create_remotion_clip.
allowed-tools:
  - create_remotion_clip
license: MIT
---

# استایل‌های انیمیشن

HiveGPT vendors the open [deenukhan/animation-styles](https://github.com/deenukhan/animation-styles)
Remotion pack (MIT) plus HiveGPT extras. Rendering happens on the Remotion worker via
`create_remotion_clip` — you do not write new Remotion files in chat.

## Flow

1. Pick a style theme id (see clip-builder skill list). Confirm topic + captions + audio.
2. Put caption copy into `scenes` (headings/bodies). Durations may be ~1s each; the film itself is
   ~۵ seconds at 1080×1350.
3. Call `create_remotion_clip` with that `theme` (not `brand-dark`).
4. Return the tool markdown so the MP4 plays in chat.

## Restyle

«همین را claymation کن» / «synthwave»: keep scenes and audio, change `theme`, bump `version`.
