/** Storyboard v2 as validated by `src/storyboard.mjs` (keep the two in sync). */
export type Lang = 'fa' | 'en';
export type AspectRatio = '9:16' | '4:5' | '1:1' | '16:9';
export type ThemeId = 'midnight' | 'aurora' | 'daylight' | 'sunset' | 'editorial' | 'neon';
export type TransitionId = 'fade' | 'slide' | 'wipe' | 'flip' | 'clock-wipe' | 'none';
export type ChartKind = 'bar' | 'line' | 'pie' | 'donut';
export type ImageMotion = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'still';
export type MusicTrack = 'ambient' | 'pulse' | 'cinematic';

interface SceneBase {
  id: string;
  durationSec: number;
  transition: TransitionId;
  narration?: string;
  accent?: string;
}

export interface HookScene extends SceneBase {
  type: 'hook';
  headline: string;
  subline?: string;
  kicker?: string;
  emphasis?: string[];
  icon?: string;
}
export interface StatScene extends SceneBase {
  type: 'stat';
  value: number;
  decimals: number;
  prefix?: string;
  suffix?: string;
  label: string;
  caption?: string;
  icon?: string;
}
export interface ChartScene extends SceneBase {
  type: 'chart';
  chart: ChartKind;
  title?: string;
  unit?: string;
  caption?: string;
  data: Array<{ label: string; value: number }>;
  highlight?: number;
}
export interface IconsScene extends SceneBase {
  type: 'icons';
  title?: string;
  layout: 'grid' | 'list';
  items: Array<{ icon: string; label: string; detail?: string }>;
}
export interface StepsScene extends SceneBase {
  type: 'steps';
  title?: string;
  steps: Array<{ title: string; detail?: string; icon?: string }>;
}
export interface TimelineScene extends SceneBase {
  type: 'timeline';
  title?: string;
  events: Array<{ date: string; title: string; detail?: string }>;
}
export interface CompareSide {
  label: string;
  points: string[];
  icon?: string;
}
export interface CompareScene extends SceneBase {
  type: 'compare';
  title?: string;
  left: CompareSide;
  right: CompareSide;
  verdict?: string;
}
export interface QuoteScene extends SceneBase {
  type: 'quote';
  quote: string;
  author?: string;
  role?: string;
}
export interface ImageScene extends SceneBase {
  type: 'image';
  image: string;
  headline?: string;
  caption?: string;
  motion: ImageMotion;
}
export interface SplitScene extends SceneBase {
  type: 'split';
  headline: string;
  body?: string;
  bullets: string[];
  image?: string;
  icon?: string;
  side: 'start' | 'end';
}
export interface ListScene extends SceneBase {
  type: 'list';
  title: string;
  bullets: string[];
  icon?: string;
}
export interface LocationScene extends SceneBase {
  type: 'location';
  place: string;
  region?: string;
  detail?: string;
  label?: string;
  icon: string;
}
export interface CtaScene extends SceneBase {
  type: 'cta';
  headline: string;
  action?: string;
  url?: string;
  handle?: string;
}
export interface LogoScene extends SceneBase {
  type: 'logo';
  image?: string;
  text?: string;
  tagline?: string;
}

export type Scene =
  | HookScene
  | StatScene
  | ChartScene
  | IconsScene
  | StepsScene
  | TimelineScene
  | CompareScene
  | QuoteScene
  | ImageScene
  | SplitScene
  | ListScene
  | LocationScene
  | CtaScene
  | LogoScene;

export type SceneType = Scene['type'];

export interface Storyboard {
  version: 2;
  title: string;
  lang: Lang;
  aspectRatio: AspectRatio;
  theme: ThemeId;
  brandName: string;
  brandColor?: string;
  logo?: string;
  captions: boolean;
  music?: { track: MusicTrack; volume: number };
  scenes: Scene[];
}

export interface TimelineEntry {
  from: number;
  frames: number;
  seqFrames: number;
  transitionOut: number;
}

export interface CaptionWord {
  text: string;
  /** Absolute frame range in the composition */
  start: number;
  end: number;
}

export interface SceneAudio {
  src: string;
  /** Absolute start frame and length in frames */
  from: number;
  frames: number;
}

export type IconNode = [string, Record<string, string>];

export interface AssetRef {
  src: string;
  credit?: string;
}

/** Props of the HiveGPTStudio composition, built by the worker. */
export interface StudioProps extends Record<string, unknown> {
  storyboard: Storyboard;
  timeline: { scenes: TimelineEntry[]; totalFrames: number };
  icons: Record<string, IconNode[]>;
  assets: Record<string, AssetRef>;
  narration: SceneAudio[];
  words: CaptionWord[];
  uploadAudio?: string;
  size: { width: number; height: number };
}
