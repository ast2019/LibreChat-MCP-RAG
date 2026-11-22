import { ClipTools } from 'librechat-data-provider';
import {
  CLIP_CHARTS,
  CLIP_SCENE_TYPES,
  CLIP_TRANSITIONS,
  CLIP_MUSIC_TRACKS,
  CLIP_ASPECT_RATIOS,
  CLIP_IMAGE_MOTIONS,
} from './scene';
import { CLIP_THEMES } from './themes';

export interface ClipToolDefinition {
  name: ClipTools;
  description: string;
  schema: Record<string, unknown>;
  responseFormat: 'content_and_artifact';
}

/** Per-type fields, compact: it rides every call. `?` marks optional fields. */
const SCENE_FIELDS = [
  'hook{headline,subline?,kicker?,emphasis?[words],icon?}',
  'stat{value:number,label,prefix?,suffix?,decimals?,caption?,icon?}',
  'chart{chart:bar|line|pie|donut,data[2-8]{label,value},title?,unit?,highlight?:index,caption?}',
  'icons{items[2-6]{icon,label,detail?},layout?:grid|list,title?}',
  'steps{steps[2-5]{title,detail?,icon?},title?}',
  'timeline{events[2-6]{date,title,detail?},title?}',
  'compare{left{label,points[1-4],icon?},right{...},title?,verdict?}',
  'quote{quote,author?,role?}',
  'image{image,headline?,caption?,motion?}',
  'split{headline,body?,bullets?[0-4],image?|icon?,side?:start|end}',
  'list{title,bullets[1-6],icon?}',
  'location{place,region?,detail?,label?,icon?}',
  'cta{headline,action?,url?,handle?}',
  'logo{image?,text?,tagline?}',
].join('; ');

const IMAGE_REF = {
  type: 'object',
  description:
    '{source:"file",file_id} (attached or generated in this chat) | {source:"ai",prompt} (if offered) | {source:"stock",query} (if offered)',
  properties: {
    source: { type: 'string', enum: ['file', 'ai', 'stock'] },
    file_id: { type: 'string' },
    prompt: { type: 'string' },
    query: { type: 'string' },
  },
  required: ['source'],
};

const LABELLED = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      value: { type: 'number' },
      icon: { type: 'string' },
      detail: { type: 'string' },
      title: { type: 'string' },
      date: { type: 'string' },
    },
  },
};

const SIDE = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
    icon: { type: 'string' },
  },
};

export const clipToolDefinitions: Record<ClipTools, ClipToolDefinition> = {
  [ClipTools.clip]: {
    name: ClipTools.clip,
    description: `Renders a motion-graphics MP4 from a storyboard on the HiveGPT worker, in the background: the call returns at once with a progress card, the video replaces it when done. Plan with the «clip-builder» skill and get the user's OK on the outline first; call once per clip and never retry on your own. Every scene's visuals come from its own fields. Scene types and fields: ${SCENE_FIELDS}. Icons are Tabler names (kebab-case, e.g. bolt, solar-panel, chart-bar). Each scene: duration_sec 1-30, transition, narration (spoken line when audio.mode=tts; scenes stretch to fit it). preview:true returns key frames instead of rendering.`,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Clip title (filename)' },
        lang: { type: 'string', enum: ['fa', 'en'], description: 'Default: detected from the text' },
        aspect_ratio: { type: 'string', enum: [...CLIP_ASPECT_RATIOS] },
        theme: { type: 'string', enum: [...CLIP_THEMES] },
        brand_name: { type: 'string' },
        brand_color: { type: 'string', description: 'Accent hex, e.g. #2ea884' },
        logo_file_id: { type: 'string' },
        captions: { type: 'boolean', description: 'Word-synced captions with TTS (default true)' },
        music: { type: 'string', enum: [...CLIP_MUSIC_TRACKS, 'none'] },
        music_volume: { type: 'number', description: '0-1, default 0.22; ducked under narration' },
        audio: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['none', 'tts', 'upload'] },
            voice: { type: 'string', description: 'Edge voice, e.g. fa-IR-DilaraNeural, fa-IR-FaridNeural, en-US-JennyNeural' },
            file_id: { type: 'string', description: 'upload: an attached audio file id' },
          },
          required: ['mode'],
        },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: [...CLIP_SCENE_TYPES] },
              duration_sec: { type: 'number' },
              transition: { type: 'string', enum: [...CLIP_TRANSITIONS] },
              narration: { type: 'string' },
              headline: { type: 'string' },
              subline: { type: 'string' },
              kicker: { type: 'string' },
              emphasis: { type: 'array', items: { type: 'string' } },
              icon: { type: 'string' },
              value: { type: 'number' },
              prefix: { type: 'string' },
              suffix: { type: 'string' },
              decimals: { type: 'number' },
              label: { type: 'string' },
              caption: { type: 'string' },
              chart: { type: 'string', enum: [...CLIP_CHARTS] },
              title: { type: 'string' },
              unit: { type: 'string' },
              highlight: { type: 'number' },
              data: LABELLED,
              layout: { type: 'string', enum: ['grid', 'list'] },
              items: LABELLED,
              steps: LABELLED,
              events: LABELLED,
              left: SIDE,
              right: SIDE,
              verdict: { type: 'string' },
              quote: { type: 'string' },
              author: { type: 'string' },
              role: { type: 'string' },
              image: IMAGE_REF,
              motion: { type: 'string', enum: [...CLIP_IMAGE_MOTIONS] },
              body: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
              side: { type: 'string', enum: ['start', 'end'] },
              place: { type: 'string' },
              region: { type: 'string' },
              detail: { type: 'string' },
              action: { type: 'string' },
              url: { type: 'string' },
              handle: { type: 'string' },
              text: { type: 'string' },
              tagline: { type: 'string' },
            },
            required: ['type', 'duration_sec'],
          },
        },
        preview: { type: 'boolean' },
        version: { type: 'number', description: '1 for the first clip in this chat, then +1' },
      },
      required: ['title', 'scenes'],
    },
    responseFormat: 'content_and_artifact',
  },
};
