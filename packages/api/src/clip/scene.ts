import type { TClipToolsConfig } from 'librechat-data-provider';
import type { ClipTheme } from './themes';
import { isClipTheme } from './themes';

export type ClipAspectRatio = '9:16' | '16:9';
export type { ClipTheme } from './themes';
export type ClipSceneType = 'title' | 'bullets' | 'closing';
export type ClipAudioMode = 'none' | 'tts' | 'upload';

export interface ClipScene {
  type: ClipSceneType;
  durationSec: number;
  heading?: string;
  body?: string;
  bullets?: string[];
}

export interface ClipAudioSpec {
  mode: ClipAudioMode;
  fileId?: string;
  ttsText?: string;
  voice?: string;
}

export interface ClipSpec {
  title: string;
  durationSec: number;
  aspectRatio: ClipAspectRatio;
  theme: ClipTheme;
  brandName: string;
  brandColor: string;
  logoFileId?: string;
  scenes: ClipScene[];
  audio: ClipAudioSpec;
  version: number;
}

export interface WorkerRenderRequest {
  title: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  theme: ClipTheme;
  brandName: string;
  brandColor: string;
  scenes: ClipScene[];
  /** Optional narration/music as base64 (mp3/wav/m4a) */
  audioBase64?: string;
  audioMime?: string;
  /** When set, the worker synthesizes free TTS (edge-tts) before rendering. */
  ttsText?: string;
  ttsVoice?: string;
}

const FILE_ID = /^[A-Za-z0-9_-]{6,100}$/;
const HEX = /^#([0-9a-fA-F]{6})$/;

function str(value: unknown, max = 2_000): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value).trim();
  return text === '' ? undefined : text.slice(0, max);
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clampDuration(value: unknown, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return Math.min(max, Math.max(0.5, Math.round(n * 10) / 10));
}

/** Parses and clamps the model tool input into a clip spec, or a user-facing error string. */
export function parseClipInput(
  input: Record<string, unknown>,
  config: TClipToolsConfig,
): ClipSpec | string {
  const title = str(input.title, 120);
  if (!title) {
    return 'A title is required.';
  }
  const rawScenes = Array.isArray(input.scenes) ? input.scenes : [];
  if (rawScenes.length === 0) {
    return 'At least one scene is required.';
  }
  if (rawScenes.length > 12) {
    return 'At most 12 scenes are allowed.';
  }

  const scenes: ClipScene[] = [];
  for (const raw of rawScenes) {
    const item = record(raw);
    const type = item.type;
    if (type !== 'title' && type !== 'bullets' && type !== 'closing') {
      return 'Each scene needs type title, bullets or closing.';
    }
    const durationSec = clampDuration(item.duration_sec, config.maxDurationSec);
    if (durationSec == null) {
      return 'Each scene needs a positive duration_sec.';
    }
    const bullets = Array.isArray(item.bullets)
      ? item.bullets
          .map((b) => str(b, 120))
          .filter((b): b is string => b != null)
          .slice(0, 6)
      : undefined;
    scenes.push({
      type,
      durationSec,
      ...(str(item.heading, 160) ? { heading: str(item.heading, 160) } : {}),
      ...(str(item.body, 400) ? { body: str(item.body, 400) } : {}),
      ...(bullets && bullets.length > 0 ? { bullets } : {}),
    });
  }

  const sceneSum = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  let durationSec = clampDuration(input.duration_sec, config.maxDurationSec) ?? sceneSum;
  if (durationSec > config.maxDurationSec) {
    return `Duration must be at most ${config.maxDurationSec} seconds.`;
  }
  if (Math.abs(sceneSum - durationSec) > 0.6) {
    /** Prefer the scene sum when the model drifted; still clamp. */
    durationSec = Math.min(config.maxDurationSec, sceneSum);
  }

  const aspectRatio = input.aspect_ratio === '16:9' ? '16:9' : '9:16';
  const theme: ClipTheme = isClipTheme(input.theme) ? input.theme : 'brand-dark';
  const brandName = str(input.brand_name, 40) ?? 'HiveGPT';
  const brandColor =
    typeof input.brand_color === 'string' && HEX.test(input.brand_color.trim())
      ? input.brand_color.trim()
      : '#2ea884';
  const logoFileId = str(input.logo_file_id, 100);
  if (logoFileId && !FILE_ID.test(logoFileId)) {
    return 'logo_file_id is not a valid file id.';
  }

  const audioRaw = record(input.audio);
  const mode =
    audioRaw.mode === 'tts' || audioRaw.mode === 'upload' || audioRaw.mode === 'none'
      ? audioRaw.mode
      : 'none';
  const fileId = str(audioRaw.file_id, 100);
  if (mode === 'upload') {
    if (!fileId || !FILE_ID.test(fileId)) {
      return 'audio.mode=upload needs a valid audio.file_id from a file the user attached.';
    }
  }
  const version = Math.min(999, Math.max(1, Math.round(Number(input.version)) || 1));

  return {
    title,
    durationSec,
    aspectRatio,
    theme,
    brandName,
    brandColor,
    ...(logoFileId && FILE_ID.test(logoFileId) ? { logoFileId } : {}),
    scenes,
    audio: {
      mode,
      ...(mode === 'upload' && fileId ? { fileId } : {}),
      ...(str(audioRaw.tts_text, 4_000) ? { ttsText: str(audioRaw.tts_text, 4_000) } : {}),
      ...(str(audioRaw.voice, 80) ? { voice: str(audioRaw.voice, 80) } : {}),
    },
    version,
  };
}

export function dimensionsFor(
  aspectRatio: ClipAspectRatio,
  height: number,
): { width: number; height: number } {
  const h = height;
  if (aspectRatio === '16:9') {
    return { width: Math.round((h * 16) / 9), height: h };
  }
  return { width: Math.round((h * 9) / 16), height: h };
}

export function narrationTextFromSpec(spec: ClipSpec): string {
  if (spec.audio.ttsText) {
    return spec.audio.ttsText;
  }
  const parts: string[] = [];
  for (const scene of spec.scenes) {
    if (scene.heading) {
      parts.push(scene.heading);
    }
    if (scene.body) {
      parts.push(scene.body);
    }
    if (scene.bullets?.length) {
      parts.push(scene.bullets.join('، '));
    }
  }
  return parts.join('. ').trim();
}
