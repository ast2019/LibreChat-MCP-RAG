import { Providers } from '@librechat/agents';
import { GraphEvents } from '@librechat/agents';
import { ContentTypes, StepTypes, ReasoningLabelEvents } from 'librechat-data-provider';
import {
  createReasoningLabelHostWiring,
  generateReasoningLabelRevision,
  getLabelUsageSequenceSeed,
  type CreateReasoningLabelHostWiringOptions,
} from './host';

function createHost(
  overrides: Partial<CreateReasoningLabelHostWiringOptions> = {},
): ReturnType<typeof createReasoningLabelHostWiring> {
  return createReasoningLabelHostWiring({
    config: { enabled: true },
    getContentParts: () => [],
    getStepIndex: () => undefined,
    emitEvent: async () => undefined,
    trackPendingFill: () => undefined,
    generateLabel: async () => ({}),
    ...overrides,
  });
}

describe('reasoning label host', () => {
  it('seeds shared usage from the highest run-global reasoning high-water', () => {
    const parts = [
      { type: ContentTypes.ACTIVITY_LABEL },
      { type: ContentTypes.ACTIVITY_LABEL },
      ...[1, 2, 3, 4].map((reasoning_label_revision) => ({
        type: ContentTypes.THINK,
        reasoning_label_revision,
      })),
    ];

    expect(getLabelUsageSequenceSeed(parts)).toBe(6);
    expect(
      getLabelUsageSequenceSeed([
        ...parts,
        { type: ContentTypes.THINK, reasoning_label_attempts: 7 },
      ]),
    ).toBe(9);
    expect(getLabelUsageSequenceSeed(parts, 12)).toBe(12);
  });

  it('owns the abort scope around the runtime wiring', () => {
    const abort = new AbortController();
    const host = createHost({ abortSignal: abort.signal });

    expect(host.scope.closed).toBe(false);
    expect(host.scope.abort.signal.aborted).toBe(false);

    abort.abort();

    expect(host.scope.closed).toBe(true);
    expect(host.scope.abort.signal.aborted).toBe(true);
  });

  it('retries the resumable marker once without rejecting the run', async () => {
    const markResumable = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('transient marker failure'))
      .mockResolvedValueOnce(undefined);
    const onMarkFailure = jest.fn();

    const host = createHost({ markResumable, onMarkFailure });
    await host.markedPromise;

    expect(markResumable).toHaveBeenCalledTimes(2);
    expect(onMarkFailure).not.toHaveBeenCalled();
  });

  it('emits a same-step reset for a resumed step titled from an encoded payload', async () => {
    const encoded = Buffer.from(Array.from({ length: 900 }, (_, i) => (i * 37 + 3) % 256)).toString(
      'base64',
    );
    const parts = [
      {
        type: ContentTypes.THINK,
        think: encoded,
        reasoning_label: 'Inspecting an encoded data snapshot',
        reasoning_label_step_id: 'reasoning-1',
        reasoning_label_revision: 1,
        reasoning_label_attempts: 1,
      },
    ];
    const emitEvent = jest.fn(async () => undefined);
    const pending: Promise<void>[] = [];
    const host = createHost({
      seedFromContent: true,
      getContentParts: () => parts,
      getStepIndex: (stepId) => (stepId === 'reasoning-1' ? 0 : undefined),
      emitEvent,
      trackPendingFill: (task) => pending.push(task),
    });
    const handlers = host.wiring.handlers({
      [GraphEvents.ON_RUN_STEP]: { handle: () => undefined },
    });
    await handlers?.[GraphEvents.ON_RUN_STEP]?.handle(GraphEvents.ON_RUN_STEP, {
      id: 'reasoning-1',
      stepDetails: {
        type: StepTypes.MESSAGE_CREATION,
        message_creation: { content_type: ContentTypes.THINK },
      },
    } as never);
    await Promise.all(pending);

    expect(emitEvent).toHaveBeenCalledWith(ReasoningLabelEvents.ON_REASONING_LABEL, {
      index: 0,
      stepId: 'reasoning-1',
      previousStepId: 'reasoning-1',
      attempts: 1,
      reset: true,
    });
  });
});

describe('generateReasoningLabelRevision admission', () => {
  const revision = (admit: Parameters<typeof generateReasoningLabelRevision>[0]['admit']) => {
    const run = { generateReasoningLabel: jest.fn(async () => ({ label: 'Weighing options' })) };
    const recordUsage = jest.fn();
    const result = generateReasoningLabelRevision({
      payload: {
        visibleReasoning: 'compare the two plans',
        reasoningStepId: 'step-1',
        revision: 1,
        status: 'final',
        charLimit: 80,
        signal: new AbortController().signal,
      } as never,
      run,
      resolveModel: async () => ({
        provider: Providers.OPENROUTER,
        clientOptions: { model: 'gpt-5-nano' },
        endpoint: 'OpenRouter',
        sameEndpoint: false,
      }),
      sourceRunId: 'r',
      sourceTraceId: 't',
      responseId: 'r',
      sessionId: 'c',
      recordUsage,
      admit,
    });
    return { run, recordUsage, result };
  };

  it('skips the revision before the model is invoked when it is refused', async () => {
    const admit = jest.fn(async () => ({ ok: false as const, error: { code: 'token_balance' } }));
    const { run, result } = revision(admit);

    await expect(result).resolves.toEqual({});
    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'OpenRouter' }),
      expect.stringContaining('compare the two plans'),
    );
    expect(run.generateReasoningLabel).not.toHaveBeenCalled();
  });

  it('runs an admitted revision and releases its credits', async () => {
    const release = jest.fn(async () => undefined);
    const { run, result } = revision(async () => ({ ok: true, release }));

    await expect(result).resolves.toMatchObject({ label: 'Weighing options' });
    expect(run.generateReasoningLabel).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
