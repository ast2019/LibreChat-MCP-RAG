import path from 'path';
import { logger } from '@librechat/data-schemas';
import { configSchema, AnthropicEffort } from 'librechat-data-provider';
import type { TCustomConfig } from 'librechat-data-provider';
import { createCustomConfigLoader } from './loader';
import { loadYaml } from '~/utils/yaml';

/**
 * The production config (`CONFIG_PATH=config/librechat.saas.yaml`) is parsed by
 * `configSchema.strict()` at boot, and a failure exits the api process (0.38.13, #117).
 * This spec runs the real loader on the real file so a bad value fails locally and in
 * `npm run verify:prod` instead of in a Coolify restart loop.
 */
const SAAS_CONFIG = path.resolve(__dirname, '../../../../config/librechat.saas.yaml');

describe('config/librechat.saas.yaml', () => {
  const originalConfigPath = process.env.CONFIG_PATH;

  beforeEach(() => {
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalConfigPath === undefined) {
      delete process.env.CONFIG_PATH;
    } else {
      process.env.CONFIG_PATH = originalConfigPath;
    }
  });

  it('parses with the strict config schema', () => {
    const raw = loadYaml(SAAS_CONFIG);
    const result = configSchema.strict().safeParse(raw);
    expect(result.error?.errors ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('loads through the boot loader without exiting', async () => {
    process.env.CONFIG_PATH = SAAS_CONFIG;
    const load = createCustomConfigLoader({
      loadLocal: loadYaml,
      defaultConfigPath: SAAS_CONFIG,
      redactConfig: (config: TCustomConfig) => config,
    });
    const config = await load(false, { mode: 'reload' });
    expect(config).not.toBeNull();
  });

  it('keeps thinking and a valid effort on every time-pack spec', () => {
    const parsed = configSchema.parse(loadYaml(SAAS_CONFIG));
    const specs = (parsed.modelSpecs?.list ?? []).filter((spec) => spec.timePack === true);
    expect(specs.map((spec) => spec.name).sort()).toEqual([
      'time-fable',
      'time-haiku',
      'time-pro',
      'time-smart',
    ]);
    const efforts = new Set<string>(Object.values(AnthropicEffort));
    for (const spec of specs) {
      expect(spec.preset.endpoint).toBe('ClaudeTime');
      expect(spec.preset.thinking).toBe(true);
      expect(efforts.has(String(spec.preset.effort))).toBe(true);
    }
  });
});
