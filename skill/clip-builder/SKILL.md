---
name: clip-builder
display-title: کلیپ‌ساز
description: Plans and builds a short branded MP4 clip on the HiveGPT Remotion worker - titles, bullets, captions, optional TTS or uploaded narration (کلیپ، ریلز، تیک‌تاک، استوری، ویدیو کوتاه). Use when the user wants a short clip or reel.
allowed-tools:
  - create_remotion_clip
license: MIT
---

# کلیپ‌ساز

## The flow

Go one step per message and wait where a step says so.

1. **Brief (wait).** Ask only what is still unknown. When `ask_user_question` is available, ask
   with it, not in text: at most four questions in one call, in the order below, each with 2 to 5
   short options in the user's language and `recommended` set to the default; whatever you did
   not ask takes its default, named in one line when you go on. Without the tool, ask in one
   message, each item with a default the user can accept with «خوب است»:
   - topic and the one message the clip should leave
   - length: ۵ ثانیه، ۱۵ ثانیه (default)، ۳۰ ثانیه (hard max)
   - aspect: عمودی ۹:۱۶ (default for Reels/TikTok)، افقی ۱۶:۹
   - theme: تیره برند (`brand-dark`, default)، روشن برند (`brand-light`)، ساده یو‌جی‌سی (`ugc`)
   - audio, always asked: «بدون صدا» (default)، «متن به گفتار» (TTS on the server, free for
     now)، «صوت خودم» (the user attaches an audio file to a message)
   Building the clip does not add a separate fee beyond this conversation's token use.
2. **Outline (wait).** One line per scene: its type (`title`, `bullets`, `closing`), about how
   many seconds, and what it says. Durations should sum to the chosen length (at most ۳۰ ثانیه).
   Ask the user to approve or change it; when `ask_user_question` is available, one question with
   «تأیید طرح کلیپ» and «تغییر می‌خواهم» after the outline in the message.
3. **Build.** Call `create_remotion_clip` with every scene, then tell the user in two or three
   lines what the clip has. The chat shows the MP4 as a video card; do not invent a download link.
   Put the markdown the tool returns into your reply exactly so the video plays.

## Scenes that work

- At most twelve scenes. Prefer ۳–۶. One idea per scene.
- `title` for the hook, `bullets` for two to four short points, `closing` for the last line or CTA.
- Keep headings short; bodies under about one sentence. Bullets: at most six, each under about
  twelve words.
- Audio:
  - `none`: silent clip
  - `tts`: set `audio.mode` to `tts`; optional `audio.tts_text`, otherwise headings and bodies are
    joined. Persian TTS uses a Persian voice on the worker.
  - `upload`: the user attaches audio to this message; use the id the tool lists as `audio.file_id`
- Optional `logo_file_id` from an image attached to this message (reserved for later brand frames).
- `version`: 1 for the first clip in this chat, then one more for each new clip.

## Changes after delivery

- «کوتاه‌ترش کن»، «صحنه ۲ را عوض کن»، «با صوت خودم»: change only what they asked and keep the rest.
- Then call the tool again with every scene and the next `version`; earlier versions stay in
  «خروجی‌های این گفتگو».
- If the tool says the queue is full (only two clips render at once), tell the user to wait a
  moment and ask again.
