import { ClipTools } from 'librechat-data-provider';
import { CLIP_THEMES, CLIP_THEME_LABELS } from './themes';

export interface ClipToolDefinition {
  name: ClipTools;
  description: string;
  schema: Record<string, unknown>;
  responseFormat: 'content_and_artifact';
}

const themeList = CLIP_THEMES.map((id) => `${id} (${CLIP_THEME_LABELS[id]})`).join(', ');

const shared = `The chat shows the file as a video card; do not invent a download link. Rendering uses the HiveGPT Remotion worker (not the user's computer). Clips are at most 30 seconds at 720p. Building the clip does not add a separate fee beyond this conversation's token use. To change a clip, call the tool again with the full updated scene and the next version.`;

export const clipToolDefinitions: Record<ClipTools, ClipToolDefinition> = {
  [ClipTools.clip]: {
    name: ClipTools.clip,
    description: `Renders a short MP4 on the HiveGPT Remotion worker. Brand shells (brand-dark/light/ugc) stay text-slide clips. Every other theme is a full style film (vendored Remotion animation-styles + HiveGPT extras): real SVG/canvas motion of the pour story with caption overlay from scenes — not a colour skin. Use after the «clip-builder» skill brief. Themes: ${themeList}. Style films render at 1080×1350 for ~5s. Audio: mode "tts", "upload", or "none". ${shared}`,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Clip title for the filename and brand line.' },
        duration_sec: {
          type: 'number',
          description: 'Total length in seconds, 1–30. Defaults to the sum of scene durations.',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['9:16', '16:9'],
          description: '9:16 for Reels/TikTok (default), 16:9 for landscape.',
        },
        theme: {
          type: 'string',
          enum: [...CLIP_THEMES],
          description:
            'Visual shell or Claude animation style. Default brand-dark. Animation styles: comic-art, cgi-motion, lego, chalkboard, pixel-art, flat-vector, zackd-films, glow-sketch, ps2, dan-koe.',
        },
        brand_name: { type: 'string', description: 'Brand line, default HiveGPT.' },
        brand_color: {
          type: 'string',
          description: 'Accent hex, e.g. #2ea884. Some animation styles ignore it for their look.',
        },
        logo_file_id: {
          type: 'string',
          description: 'Optional logo image id from this request.',
        },
        scenes: {
          type: 'array',
          description: 'Ordered scenes. Durations should sum to about duration_sec.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['title', 'bullets', 'closing'],
              },
              duration_sec: { type: 'number' },
              heading: { type: 'string' },
              body: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
            },
            required: ['type', 'duration_sec'],
          },
        },
        audio: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['none', 'tts', 'upload'] },
            file_id: {
              type: 'string',
              description: 'Required when mode is upload: an audio file the user attached.',
            },
            tts_text: {
              type: 'string',
              description:
                'Narration for TTS when mode is tts. If omitted, headings and bodies are joined.',
            },
            voice: {
              type: 'string',
              description: 'Optional TTS voice id when the worker supports it.',
            },
          },
          required: ['mode'],
        },
        version: {
          type: 'number',
          description: '1 for the first clip in this chat, then increment.',
        },
      },
      required: ['title', 'scenes'],
    },
    responseFormat: 'content_and_artifact',
  },
};
