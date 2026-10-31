import { logger } from '@librechat/data-schemas';
import { specsConfigSchema } from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { CatalogueModel, ModelCatalogueSnapshot } from './discover';
import {
  parseModelFamily,
  parseAliasFamily,
  prettyModelName,
  applyAutoDiscoveredSpecs,
} from './discover';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const providers = {
  anthropic: { group: 'Claude', icon: 'anthropic' },
  openai: { group: 'ChatGPT', icon: 'openai' },
  google: { group: 'Gemini', icon: 'google' },
  deepseek: { group: 'DeepSeek', icon: 'deepseek' },
  'x-ai': { group: 'Grok', icon: 'xai' },
};

const families = ['claude-sonnet', 'claude-opus', 'gpt-sol', 'gpt-astra', 'gemini-flash'];

function spec(
  name: string,
  group: string,
  model: string,
  extra: Partial<TModelSpec> = {},
  endpoint = 'OpenRouter',
): TModelSpec {
  return { name, label: name, group, preset: { endpoint, model }, ...extra } as TModelSpec;
}

const privateSpec = (name: string, model: string) =>
  spec(name, 'محرمانه', model, { privacy: 'private' }, 'OpenRouterPrivate');

function makeConfig(list: TModelSpec[], autoDiscover: Record<string, unknown> = {}): AppConfig {
  return {
    endpoints: {
      custom: [
        { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
        { name: 'OpenRouterPrivate', baseURL: 'https://openrouter.ai/api/v1' },
      ],
    },
    modelSpecs: {
      enforce: true,
      prioritize: true,
      list,
      autoDiscover: {
        enabled: true,
        endpoint: 'OpenRouter',
        privateEndpoint: 'OpenRouterPrivate',
        insertBeforeGroup: 'ابزارها',
        providers,
        private: { enabled: true, families },
        ...autoDiscover,
      },
    },
  } as unknown as AppConfig;
}

const catalogue: CatalogueModel[] = [
  { id: '~anthropic/claude-sonnet-latest', name: 'Anthropic: Claude Sonnet Latest', created: 10 },
  { id: '~anthropic/claude-fable-latest', name: 'Anthropic: Claude Fable Latest', created: 30 },
  { id: '~openai/gpt-sol-latest', name: 'OpenAI: GPT Sol Latest', created: 20 },
  { id: '~openai/gpt-terra-latest', name: 'OpenAI: GPT Terra Latest', created: 25 },
  { id: '~x-ai/grok-latest', name: 'xAI: Grok Latest', created: 15 },
  { id: '~moonshotai/kimi-latest', name: 'MoonshotAI: Kimi Latest', created: 40 },
  { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', created: 100 },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', created: 200 },
  { id: 'anthropic/claude-sonnet-5.5:batch', name: 'Anthropic: Claude Sonnet 5.5', created: 200 },
  { id: 'anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5', created: 190 },
  { id: 'anthropic/claude-opus-6', name: 'Anthropic: Claude Opus 6', created: 300 },
  { id: 'openai/gpt-6.1-sol', name: 'OpenAI: GPT-6.1 Sol', created: 210 },
  { id: 'openai/gpt-6.1-sol-pro', name: 'OpenAI: GPT-6.1 Sol Pro', created: 220 },
  { id: 'openai/gpt-6-astra', name: 'OpenAI: GPT-6 Astra', created: 180 },
  { id: 'google/gemini-3.8-flash', name: 'Google: Gemini 3.8 Flash', created: 150 },
  { id: 'google/gemini-3.9-flash-lite', name: 'Google: Gemini 3.9 Flash Lite', created: 400 },
];

/** opus-6 is newest but has no ZDR endpoint; no alias is ever in this set */
const zdrIds = [
  'anthropic/claude-sonnet-5',
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-opus-5.5',
  'openai/gpt-6.1-sol',
  'openai/gpt-6.1-sol-pro',
  'openai/gpt-6-astra',
  'google/gemini-3.8-flash',
  'google/gemini-3.9-flash-lite',
];

let version = 0;
function snap(
  models: CatalogueModel[] | null = catalogue,
  zdr: string[] | null = zdrIds,
): ModelCatalogueSnapshot {
  return { version: ++version, models, zdr: zdr ? new Set(zdr) : null };
}

const names = (config: AppConfig) => config.modelSpecs?.list?.map((s) => s.name);
const byName = (config: AppConfig, name: string) =>
  config.modelSpecs?.list?.find((s) => s.name === name);

describe('parseModelFamily', () => {
  it.each([
    ['anthropic/claude-sonnet-5.5', 'anthropic', 'claude-sonnet', [5, 5]],
    ['anthropic/claude-opus-4.1', 'anthropic', 'claude-opus', [4, 1]],
    ['openai/gpt-6.1-sol', 'openai', 'gpt-sol', [6, 1]],
    ['openai/gpt-6-astra', 'openai', 'gpt-astra', [6]],
    ['openai/gpt-6.1-sol-pro', 'openai', 'gpt-sol-pro', [6, 1]],
    ['google/gemini-3.8-flash', 'google', 'gemini-flash', [3, 8]],
    ['google/gemini-4-argon', 'google', 'gemini-argon', [4]],
    ['google/gemini-3.5-flash-lite', 'google', 'gemini-flash-lite', [3, 5]],
    ['google/gemini-3.1-pro-preview', 'google', 'gemini-pro-preview', [3, 1]],
  ])('%s → %s/%s', (id, provider, family, version) => {
    expect(parseModelFamily(id)).toEqual({ provider, family, version });
  });

  it.each([
    '~anthropic/claude-sonnet-latest',
    'anthropic/claude-sonnet-5.5:batch',
    'google/gemma-3:free',
    'openai/gpt-4o',
    'openai/gpt-oss-120b',
    'openai/gpt-4o-2024-08-06',
    'openai/gpt-5.1-codex-max-2',
    'no-slash',
    'anthropic/5.5',
  ])('rejects %s', (id) => {
    expect(parseModelFamily(id)).toBeNull();
  });
});

describe('parseAliasFamily / prettyModelName', () => {
  it('reads alias families', () => {
    expect(parseAliasFamily('~openai/gpt-terra-latest')).toEqual({
      provider: 'openai',
      family: 'gpt-terra',
      version: [],
    });
    expect(parseAliasFamily('~deepseek/deepseek-v4-flash-latest')?.family).toBe(
      'deepseek-v4-flash',
    );
    expect(parseAliasFamily('openai/gpt-terra-latest')).toBeNull();
    expect(parseAliasFamily('~openai/gpt-terra')).toBeNull();
  });

  it('strips the provider and Latest', () => {
    expect(prettyModelName({ id: 'x', name: 'OpenAI: GPT Terra Latest' })).toBe('GPT Terra');
    expect(prettyModelName({ id: 'x', name: 'Anthropic: Claude Opus 5.5' })).toBe(
      'Claude Opus 5.5',
    );
    expect(prettyModelName({ id: '~unbiased/pareto-latest', name: 'Pareto Latest' })).toBe(
      'Pareto',
    );
  });
});

describe('applyAutoDiscoveredSpecs — public', () => {
  const base = () => [
    spec('smart', 'Claude', '~anthropic/claude-sonnet-latest', { groupIcon: 'anthropic' }),
    spec('gpt', 'ChatGPT', '~openai/gpt-sol-latest'),
    spec('research', 'ابزارها', '~google/gemini-flash-latest'),
  ];

  it('adds uncovered aliases of listed providers after their group, new groups before tools', () => {
    const result = applyAutoDiscoveredSpecs(makeConfig(base(), { private: undefined }), snap());
    expect(names(result)).toEqual([
      'smart',
      'auto-anthropic-claude-fable',
      'gpt',
      'auto-openai-gpt-terra',
      'auto-x-ai-grok',
      'research',
    ]);
    expect(byName(result, 'auto-openai-gpt-terra')).toEqual({
      name: 'auto-openai-gpt-terra',
      label: 'GPT Terra',
      description: 'جدید؛ خودکار از فهرست ChatGPT اضافه شد',
      group: 'ChatGPT',
      iconURL: 'openai',
      webSearch: true,
      fileSearch: true,
      discoveredAt: 25,
      preset: {
        endpoint: 'OpenRouter',
        model: '~openai/gpt-terra-latest',
        modelLabel: 'GPT Terra',
      },
    });
    /** Only a spec opening a new group carries the group icon */
    expect(byName(result, 'auto-openai-gpt-terra')?.groupIcon).toBeUndefined();
    expect(byName(result, 'auto-x-ai-grok')?.groupIcon).toBe('xai');
  });

  it('adds an unlisted provider’s alias in its own group only when otherProviders is on', () => {
    const list = [spec('sonnet', 'Claude', '~anthropic/claude-sonnet-latest')];
    const off = applyAutoDiscoveredSpecs(makeConfig(list), snap());
    expect(byName(off, 'auto-moonshotai-kimi')).toBeUndefined();

    const on = applyAutoDiscoveredSpecs(makeConfig(list, { otherProviders: true }), snap());
    expect(byName(on, 'auto-moonshotai-kimi')).toMatchObject({
      label: 'Kimi',
      group: 'MoonshotAI',
      discoveredAt: 40,
      preset: { endpoint: 'OpenRouter', model: '~moonshotai/kimi-latest' },
    });
    /** The prefix names a provider with a built-in icon, so the group and spec use it */
    expect(byName(on, 'auto-moonshotai-kimi')).toMatchObject({
      iconURL: 'moonshot',
      groupIcon: 'moonshot',
    });
    /** After every listed provider's group */
    const groups = on.modelSpecs?.list?.map((s) => s.group) ?? [];
    expect(groups.lastIndexOf('MoonshotAI')).toBeGreaterThan(groups.lastIndexOf('Grok'));
  });

  it('gives an unlisted provider with no built-in icon the generic or configured icon', () => {
    const list = [spec('sonnet', 'Claude', '~anthropic/claude-sonnet-latest')];
    const newcomer: CatalogueModel[] = [
      { id: '~unbiased/pareto-latest', name: 'Pareto Latest', created: 60 },
      { id: '~unbiased/pareto-mini-latest', name: 'Pareto Mini Latest', created: 55 },
    ];
    const generic = applyAutoDiscoveredSpecs(
      makeConfig(list, { otherProviders: true }),
      snap([...catalogue, ...newcomer]),
    );
    expect(byName(generic, 'auto-unbiased-pareto')).toMatchObject({
      group: 'Unbiased',
      iconURL: '/assets/ai-provider.svg',
      groupIcon: '/assets/ai-provider.svg',
    });
    /** Only the spec opening the group carries the group icon */
    expect(byName(generic, 'auto-unbiased-pareto-mini')).toMatchObject({
      iconURL: '/assets/ai-provider.svg',
    });
    expect(byName(generic, 'auto-unbiased-pareto-mini')?.groupIcon).toBeUndefined();

    const configured = applyAutoDiscoveredSpecs(
      makeConfig(list, { otherProviders: true, otherProvidersIcon: '/assets/logo.svg' }),
      snap([...catalogue, ...newcomer]),
    );
    expect(byName(configured, 'auto-unbiased-pareto')?.groupIcon).toBe('/assets/logo.svg');
  });

  it('does not set a group icon when the group already exists in the list', () => {
    const list = [
      spec('sonnet', 'Claude', '~anthropic/claude-sonnet-latest'),
      spec('kimi-k3', 'MoonshotAI', 'moonshotai/kimi-k3', { groupIcon: '/assets/kimi.png' }),
    ];
    const result = applyAutoDiscoveredSpecs(makeConfig(list, { otherProviders: true }), snap());
    expect(byName(result, 'auto-moonshotai-kimi')?.groupIcon).toBeUndefined();
    expect(byName(result, 'kimi-k3')?.groupIcon).toBe('/assets/kimi.png');
  });

  it('never folds an unlisted provider into a listed brand’s group by name', () => {
    const list = [spec('sonnet', 'Claude', '~anthropic/claude-sonnet-latest')];
    const impostor: CatalogueModel = {
      id: '~clone/claude-latest',
      name: 'Claude: X Latest',
      created: 50,
    };
    const result = applyAutoDiscoveredSpecs(
      makeConfig(list, { otherProviders: true }),
      snap([...catalogue, impostor]),
    );
    expect(byName(result, 'auto-clone-claude')).toBeUndefined();
  });

  it('skips covered (any endpoint), excluded, and unlisted-provider aliases', () => {
    const list = [
      ...base(),
      spec('fable-local', 'Other', '~anthropic/claude-fable-latest', {}, 'Elsewhere'),
    ];
    const result = applyAutoDiscoveredSpecs(
      makeConfig(list, { exclude: ['~x-ai/grok-latest'], private: undefined }),
      snap(),
    );
    expect(names(result)).toEqual([
      'smart',
      'gpt',
      'auto-openai-gpt-terra',
      'research',
      'fable-local',
    ]);
    expect(names(result)).not.toContain('auto-moonshotai-kimi');
  });

  it('never puts a public spec in the confidential group', () => {
    const config = makeConfig(base(), {
      providers: { ...providers, openai: { group: 'محرمانه', icon: 'openai' } },
      private: undefined,
    });
    const result = applyAutoDiscoveredSpecs(config, snap());
    expect(result.modelSpecs?.list?.filter((s) => s.group === 'محرمانه')).toEqual([]);
  });

  it('keeps stable names and memoizes per config and snapshot', () => {
    const config = makeConfig(base(), { private: undefined });
    const snapshot = snap();
    const first = applyAutoDiscoveredSpecs(config, snapshot);
    expect(applyAutoDiscoveredSpecs(config, snapshot)).toBe(first);
    const second = applyAutoDiscoveredSpecs(config, snap());
    expect(second).not.toBe(first);
    expect(names(second)).toEqual(names(first));
  });

  it('returns the config untouched when disabled, without a snapshot, or the endpoint is gone', () => {
    const disabled = makeConfig(base(), { enabled: false });
    expect(applyAutoDiscoveredSpecs(disabled, snap())).toBe(disabled);
    const config = makeConfig(base());
    expect(applyAutoDiscoveredSpecs(config, undefined)).toBe(config);
    const missing = makeConfig(base(), { endpoint: 'Gone', private: undefined });
    expect(applyAutoDiscoveredSpecs(missing, snap())).toBe(missing);
  });
});

describe('applyAutoDiscoveredSpecs — private (strict)', () => {
  /** Public discovery adds nothing: the catalogue's aliases are all excluded */
  const publicOff = {
    exclude: catalogue.filter((model) => model.id.startsWith('~')).map((model) => model.id),
  };

  it('upgrades a private spec to the newest ZDR id of its family, keeping its label', () => {
    const list = [privateSpec('private-smart', 'anthropic/claude-sonnet-5')];
    const result = applyAutoDiscoveredSpecs(makeConfig(list, publicOff), snap());
    const upgraded = byName(result, 'private-smart');
    expect(upgraded?.preset?.model).toBe('anthropic/claude-sonnet-5.5');
    expect(upgraded?.label).toBe('private-smart');
  });

  it('never picks a non-ZDR id, an alias, or a variant with extra tokens', () => {
    const result = applyAutoDiscoveredSpecs(makeConfig([], publicOff), snap());
    const models = result.modelSpecs?.list?.map((s) => s.preset?.model);
    /** opus-6 is newer but has no ZDR endpoint */
    expect(models).toContain('anthropic/claude-opus-5.5');
    expect(models).not.toContain('anthropic/claude-opus-6');
    /** sol-pro is newer and ZDR, but a different family */
    expect(models).toContain('openai/gpt-6.1-sol');
    expect(models).not.toContain('openai/gpt-6.1-sol-pro');
    expect(models).not.toContain('google/gemini-3.9-flash-lite');
    for (const model of models ?? []) {
      expect(model?.startsWith('~')).toBe(false);
      expect(zdrIds).toContain(model);
    }
  });

  it('adds families with no private spec as auto-private specs in the confidential group', () => {
    const list = [
      spec('gpt', 'ChatGPT', '~openai/gpt-sol-latest'),
      privateSpec('private-smart', 'anthropic/claude-sonnet-5.5'),
      spec('local', 'لوکال', 'hivegpt-local', { privacy: 'local' }, 'Local'),
    ];
    const result = applyAutoDiscoveredSpecs(makeConfig(list, publicOff), snap());
    expect(names(result)).toEqual([
      'gpt',
      'private-smart',
      'auto-private-claude-opus',
      'auto-private-gpt-sol',
      'auto-private-gpt-astra',
      'auto-private-gemini-flash',
      'local',
    ]);
    expect(byName(result, 'auto-private-claude-opus')).toEqual({
      name: 'auto-private-claude-opus',
      label: 'Claude Opus 5.5 — محرمانه',
      description: 'روی سرورهایی که داده نگه نمی‌دارند (ZDR)؛ خودکار اضافه شد',
      privacy: 'private',
      group: 'محرمانه',
      iconURL: 'anthropic',
      hideBadgeRow: true,
      preset: {
        endpoint: 'OpenRouterPrivate',
        model: 'anthropic/claude-opus-5.5',
        modelLabel: 'Claude Opus 5.5 — محرمانه',
      },
    });
    /** Every spec in the confidential group is private */
    for (const s of result.modelSpecs?.list ?? []) {
      if (s.group === 'محرمانه') {
        expect(s.privacy).toBe('private');
      }
    }
  });

  it('removes a private spec whose model has no ZDR endpoint (alias or concrete)', () => {
    const list = [
      privateSpec('private-alias', '~anthropic/claude-sonnet-latest'),
      privateSpec('private-gone', 'anthropic/claude-opus-6'),
      privateSpec('private-ok', 'google/gemini-3.8-flash'),
      spec('elsewhere', 'محرمانه', 'some/model', { privacy: 'private' }, 'Azure'),
    ];
    const result = applyAutoDiscoveredSpecs(
      makeConfig(list, { ...publicOff, private: { enabled: true, families: [] } }),
      snap(),
    );
    expect(names(result)).toEqual(['private-ok', 'elsewhere']);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('private-alias'));
  });

  it('changes no private spec without a ZDR list', () => {
    const list = [
      privateSpec('private-smart', 'anthropic/claude-sonnet-5'),
      privateSpec('private-alias', '~anthropic/claude-sonnet-latest'),
    ];
    const config = makeConfig(list, publicOff);
    expect(applyAutoDiscoveredSpecs(config, snap(catalogue, null))).toBe(config);
  });

  it('still removes non-ZDR specs when only the model list is missing, but adds nothing', () => {
    const list = [
      privateSpec('private-smart', 'anthropic/claude-sonnet-5'),
      privateSpec('private-alias', '~anthropic/claude-sonnet-latest'),
    ];
    const result = applyAutoDiscoveredSpecs(makeConfig(list, publicOff), snap(null));
    expect(names(result)).toEqual(['private-smart']);
    expect(byName(result, 'private-smart')?.preset?.model).toBe('anthropic/claude-sonnet-5');
  });

  it('honors exclude for private upgrades', () => {
    const list = [privateSpec('private-smart', 'anthropic/claude-sonnet-5')];
    const result = applyAutoDiscoveredSpecs(
      makeConfig(list, { exclude: [...publicOff.exclude, 'anthropic/claude-sonnet-5.5'] }),
      snap(),
    );
    expect(byName(result, 'private-smart')?.preset?.model).toBe('anthropic/claude-sonnet-5');
  });

  it('does nothing private when private discovery is off', () => {
    const list = [privateSpec('private-alias', '~anthropic/claude-sonnet-latest')];
    const config = makeConfig(list, { ...publicOff, private: { enabled: false } });
    expect(applyAutoDiscoveredSpecs(config, snap())).toBe(config);
  });
});

describe('modelSpecs.autoDiscover schema', () => {
  it('is optional, off by default, and keeps the configured block', () => {
    expect(specsConfigSchema.parse({ list: [] }).autoDiscover).toBeUndefined();
    const parsed = specsConfigSchema.parse({
      list: [],
      autoDiscover: {
        providers: { 'x-ai': { group: 'Grok' } },
        private: { families: ['gpt-sol'] },
      },
    }).autoDiscover;
    expect(parsed).toMatchObject({
      enabled: false,
      endpoint: 'OpenRouter',
      refreshHours: 6,
      exclude: [],
      providers: { 'x-ai': { group: 'Grok' } },
      private: { enabled: false, families: ['gpt-sol'] },
    });
    expect(
      specsConfigSchema.safeParse({ list: [], autoDiscover: { refreshHours: 0 } }).success,
    ).toBe(false);
  });
});
