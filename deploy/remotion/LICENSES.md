# Bundled assets and code in the motion studio worker

| Asset | Where | Source | License |
| --- | --- | --- | --- |
| Vazirmatn 33.003 (Regular, Bold, Black) | `public/fonts/Vazirmatn-*.ttf` | https://github.com/rastikerdar/vazirmatn (release v33.003) | SIL Open Font License 1.1, `public/fonts/Vazirmatn-OFL.txt` |
| Inter 4.1 (Regular, Bold) and Inter Display ExtraBold | `public/fonts/Inter*.ttf` | https://github.com/rsms/inter (release v4.1) | SIL Open Font License 1.1, `public/fonts/Inter-OFL.txt` |
| Tabler Icons 3.35.0, outline set (4,964 icons) | npm `@tabler/icons` (`tabler-nodes-outline.json`) | https://tabler.io/icons | MIT, © Paweł Kuna |
| Background music: `ambient`, `pulse`, `cinematic` | `public/music/*.mp3` | synthesised by `scripts/music.mjs` in this repository | CC0 1.0, `public/music/LICENSE.md` |
| Remotion 4.0.544 (`remotion`, `@remotion/*`) | npm | https://www.remotion.dev | Remotion License: free for individuals and companies with up to 3 employees; larger companies need a company license (https://www.remotion.pro/license) |
| edge-tts 7.3.1 | pip, in the Docker image | https://github.com/rany2/edge-tts | LGPL-3.0 (called as a separate process; the voice service is Microsoft Edge's online TTS) |
| React 19 | npm | https://react.dev | MIT |

The 0.39 worker vendored the deenukhan/animation-styles films (MIT). They were removed in
0.40.0; none of their code or artwork remains.

Stock photos from Pexels (optional, only with `PEXELS_API_KEY` on the api) are free to use
under the Pexels License; HiveGPT shows a «Photo: <photographer> / Pexels» credit on every
stock image scene, as Pexels asks.
