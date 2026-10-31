import { findApiModelSpec, listApiModelSpecs, resolveApiAgent } from './models';

jest.mock('~/agents/load', () => ({
  loadEphemeralAgent: jest.fn(async (params: Record<string, unknown>) => ({
    id: 'eph',
    tools: ['web_search', 'generate_image', 'generate_video'],
    ...params,
  })),
}));

const config = {
  modelSpecs: {
    list: [
      {
        name: 'smart',
        label: 'Smart',
        group: 'Claude',
        preset: {
          endpoint: 'OpenRouter',
          model: 'anthropic/claude',
          iconURL: 'x',
          temperature: 0.3,
        },
      },
      { name: 'broken', label: 'No endpoint', preset: {} },
      {
        name: 'local',
        label: 'Local',
        privacy: 'local',
        preset: { endpoint: 'Local', model: 'qwen' },
      },
    ],
  },
};

describe('API model specs', () => {
  it('finds only specs with an endpoint and lists them as models', () => {
    const req = { config } as never;
    expect(findApiModelSpec(req, 'smart')?.name).toBe('smart');
    expect(findApiModelSpec(req, 'broken')).toBeNull();
    expect(findApiModelSpec(req, 'missing')).toBeNull();
    /** The brand group stands in for the host endpoint, and a local model says so */
    expect(listApiModelSpecs(req).map((m) => [m.id, m.name, m.provider, m.privacy])).toEqual([
      ['smart', 'Smart', 'Claude', undefined],
      ['local', 'Local', 'Local', 'local'],
    ]);
  });

  it('runs a spec as its ephemeral agent and anything else as a stored agent', async () => {
    const getAgent = jest.fn().mockResolvedValue({ id: 'agent_1' });
    const deps = { getAgent, getMCPServerTools: jest.fn() };
    const req = { config, user: { id: 'u' } } as never;
    const spec = (await resolveApiAgent(req, 'smart', deps)) as unknown as Record<string, unknown>;
    expect(spec).toMatchObject({
      spec: 'smart',
      endpoint: 'OpenRouter',
      model_parameters: { model: 'anthropic/claude', temperature: 0.3 },
    });
    expect((spec.model_parameters as Record<string, unknown>).iconURL).toBeUndefined();
    expect(getAgent).not.toHaveBeenCalled();
    /** Media files are delivered to the chat UI, not to API callers */
    expect(spec.tools).toEqual(['web_search']);
    expect(await resolveApiAgent(req, 'agent_1', deps)).toEqual({ id: 'agent_1' });
  });
});
