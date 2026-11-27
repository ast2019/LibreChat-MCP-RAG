import fs from 'fs';
import path from 'path';
import { load } from 'js-yaml';
import { ClipTools, clipToolsSchema } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import {
  getChatClipTools,
  getClipConfig,
  getClipStartupConfig,
  buildClipToolContext,
  getRemotionServiceTarget,
} from './config';
import { resolveClipVoice } from './voices';

const ENV = {
  REMOTION_SERVICE_URL: 'http://remotion:3200',
  REMOTION_SERVICE_TOKEN: 't'.repeat(40),
};

const withConfig = (clipTools: unknown) => ({ config: { clipTools } }) as unknown as AppConfig;

describe('getClipConfig / getChatClipTools', () => {
  it('offers the clip tool when enabled and the worker is configured', () => {
    expect(getChatClipTools(undefined, null, ENV)).toEqual([ClipTools.clip]);
    expect(getChatClipTools(withConfig({ clip: false }), null, ENV)).toEqual([]);
    expect(getChatClipTools(undefined, null, {})).toEqual([]);
  });

  it('hides the tool on private and local specs', () => {
    expect(getChatClipTools(undefined, { privacy: 'private' }, ENV)).toEqual([]);
    expect(getChatClipTools(undefined, { privacy: 'local' }, ENV)).toEqual([]);
  });

  it('falls back to defaults when the yaml section is invalid', () => {
    expect(getClipConfig(withConfig({ maxDurationSec: 'many' }))).toMatchObject({
      clip: true,
      maxDurationSec: 90,
      height: 720,
      maxConcurrent: 1,
      maxJobsPerUser: 1,
      aiImages: false,
      renderTimeoutSec: 600,
    });
  });

  it('offers the Edge voices when voices is not set', () => {
    const { voices } = getClipConfig(undefined);
    expect(voices.map((v) => v.id)).toEqual(['fa-IR-DilaraNeural', 'fa-IR-FaridNeural', 'en-US-JennyNeural']);
    expect(voices.every((v) => v.provider === 'edge')).toBe(true);
  });

  it('parses a voice catalogue and requires a model for openrouter voices', () => {
    const edge = { id: 'dilara', label: 'دیلارا', lang: 'fa', provider: 'edge', voice: 'fa-IR-DilaraNeural' };
    const kore = { id: 'kore', label: 'Kore', lang: 'fa', provider: 'openrouter', voice: 'Kore', model: 'google/gemini-3.8-flash-tts' };
    expect(getClipConfig(withConfig({ voices: [edge, kore] })).voices.map((v) => v.id)).toEqual(['dilara', 'kore']);
    const { model: _model, ...noModel } = kore;
    /** An invalid catalogue falls back to the defaults, like any invalid clipTools section. */
    expect(getClipConfig(withConfig({ voices: [edge, noModel] })).voices[0].id).toBe('fa-IR-DilaraNeural');
    expect(clipToolsSchema.safeParse({ voices: [noModel] }).success).toBe(false);
    expect(clipToolsSchema.safeParse({ voices: [] }).success).toBe(false);
  });

  it('lists the voice ids in the tool context', () => {
    const context = buildClipToolContext(['create_remotion_clip'], [], [], undefined, ENV);
    expect(context.create_remotion_clip).toContain('fa-IR-DilaraNeural (دیلارا, fa)');
  });

  it('caps the clip length at 180 seconds', () => {
    expect(getClipConfig(withConfig({ maxDurationSec: 180 })).maxDurationSec).toBe(180);
    expect(getClipConfig(withConfig({ maxDurationSec: 181 })).maxDurationSec).toBe(90);
  });
});

describe('getClipStartupConfig', () => {
  it('is on only when the yaml switch and the worker env are both set', () => {
    expect(getClipStartupConfig(undefined, ENV)).toEqual({ clip: true, wizard: false });
    expect(getClipStartupConfig(withConfig({ clip: false }), ENV)).toEqual({
      clip: false,
      wizard: false,
    });
    expect(getClipStartupConfig(undefined, {})).toEqual({ clip: false, wizard: false });
  });

  it('turns the wizard on only with clipTools.wizard.enabled', () => {
    expect(getClipStartupConfig(withConfig({ wizard: { enabled: true } }), ENV).wizard).toBe(true);
    expect(getClipStartupConfig(withConfig({ wizard: { enabled: true } }), {}).wizard).toBe(false);
  });
});

describe('getRemotionServiceTarget', () => {
  it('needs a http(s) url and a token of at least 32 characters', () => {
    expect(getRemotionServiceTarget(ENV)).toEqual({
      url: 'http://remotion:3200',
      token: 't'.repeat(40),
    });
    expect(getRemotionServiceTarget({ REMOTION_SERVICE_URL: 'http://remotion:3200' })).toBeNull();
    expect(
      getRemotionServiceTarget({
        REMOTION_SERVICE_URL: 'http://remotion:3200',
        REMOTION_SERVICE_TOKEN: 'short',
      }),
    ).toBeNull();
  });
});

describe('buildClipToolContext', () => {
  it('lists attached images and audio for the clip tool', () => {
    const context = buildClipToolContext(
      [ClipTools.clip],
      [{ file_id: 'img-123456', filename: 'logo.png' }],
      [{ file_id: 'aud-123456', filename: 'voice.mp3' }],
    );
    expect(Object.keys(context)).toEqual([ClipTools.clip]);
    expect(context[ClipTools.clip]).toContain('img-123456');
    expect(context[ClipTools.clip]).toContain('aud-123456');
    expect(context[ClipTools.clip]).toContain('logo_file_id');
  });

  it('still describes the tool when nothing is attached', () => {
    const context = buildClipToolContext([ClipTools.clip], [], []);
    expect(context[ClipTools.clip]).toContain('create_remotion_clip');
    expect(context[ClipTools.clip]).toContain('storyboard motion graphics');
  });
});

describe('config/librechat.saas.yaml clipTools', () => {
  const file = path.resolve(__dirname, '../../../../config/librechat.saas.yaml');
  const raw = (load(fs.readFileSync(file, 'utf8')) as { clipTools: unknown }).clipTools;

  it('parses, with ElevenLabs first and Edge Dilara last for Persian', () => {
    const parsed = clipToolsSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    const config = clipToolsSchema.parse(raw);
    expect(config.maxJobsPerUser).toBe(3);
    expect(config.maxConcurrent).toBe(2);
    const fa = config.voices.filter((v) => v.lang === 'fa');
    expect(fa[0]).toMatchObject({ provider: 'openrouter', model: 'elevenlabs/eleven-v3' });
    expect(fa.slice(0, 4).map((v) => v.voice)).toEqual(['sarah', 'alice', 'george', 'brian']);
    expect(fa[fa.length - 1]).toMatchObject({ provider: 'edge', voice: 'fa-IR-DilaraNeural' });
    expect(config.voices.map((v) => v.id)).not.toEqual(
      expect.arrayContaining(['gemini-leda', 'gemini-puck', 'fa-IR-FaridNeural']),
    );
    expect(resolveClipVoice(config, undefined, 'fa')).toMatchObject({
      ok: true,
      choice: { provider: 'openrouter', voice: 'sarah', format: 'mp3', estimateUsdPerKChar: 0.08 },
    });
    expect(resolveClipVoice(config, undefined, 'en')).toMatchObject({
      ok: true,
      choice: { provider: 'edge' },
    });
  });
});
