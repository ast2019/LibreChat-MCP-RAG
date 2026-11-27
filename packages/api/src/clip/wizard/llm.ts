import { logger } from '@librechat/data-schemas';
import type { TClipToolsConfig } from 'librechat-data-provider';
import type { MediaBilling, MediaCharge } from '~/media/billing';
import type { MediaFetch } from '~/media/types';
import type { ServerRequest } from '~/types';
import type { WizardModel } from './models';
import { resolveCustomEndpointTokenConfig } from '~/endpoints/custom/initialize';
import { getCustomEndpointConfig } from '~/app/config';
import { resolveSpeechEndpoint } from '~/speech/config';
import { getSafeErrorMetadata } from '~/utils/errors';
import { isUserProvided } from '~/utils';

/** Transaction context of the wizard's model calls. */
export const WIZARD_LLM_CONTEXT = 'clip_wizard';

export type LlmTurn = { role: 'system' | 'user' | 'assistant'; content: string };

/** What a parser makes of the model's text: a value, or feedback the model gets to fix it. */
export type LlmParsed<T> = { ok: true; value: T } | { ok: false; feedback: string };

export type LlmRefusal = 'insufficient_credit' | 'provider_failed' | 'unavailable';

export type LlmResult<T> =
  | { ok: true; value: T; credits: number }
  | { ok: false; code: LlmRefusal };

export interface LlmRun<T> {
  system: string;
  turns: LlmTurn[];
  parse: (text: string) => LlmParsed<T>;
}

type TokenConfig = Record<string, Record<string, number>>;

export interface WizardLlmDeps {
  billing: MediaBilling;
  /** Chat billing's rate lookup (`getMultiplier` of the transaction methods) */
  getMultiplier: (params: {
    model?: string;
    endpoint?: string;
    tokenType?: 'prompt' | 'completion';
    endpointTokenConfig?: TokenConfig;
  }) => number;
  /** Defaults to chat's custom-endpoint price resolution */
  getEndpointTokenConfig?: (
    req: ServerRequest,
    endpoint: string,
  ) => Promise<TokenConfig | undefined>;
  fetch?: MediaFetch;
}

/**
 * Calls the wizard's model. Credits are held before the call, charged once after a usable
 * answer at chat's token rates, and released in every case; a provider failure or an answer that
 * cannot be repaired charges nothing.
 */
export interface WizardLlm {
  run<T>(
    req: ServerRequest,
    config: Pick<TClipToolsConfig, 'wizard'>,
    model: WizardModel,
    job: LlmRun<T>,
  ): Promise<LlmResult<T>>;
}

/** Tokens assumed for a text before the call: Persian is token-heavy, so two characters each. */
const tokensOf = (text: string): number => Math.ceil(text.length / 2);

/** The JSON object in a model answer, with a code fence or surrounding prose removed. */
export function extractJson(text: string): unknown {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return undefined;
    }
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

type Completion = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export function createWizardLlm(deps: WizardLlmDeps): WizardLlm {
  const doFetch: MediaFetch = deps.fetch ?? ((url, init) => fetch(url, init));

  async function tokenConfig(
    req: ServerRequest,
    endpoint: string,
  ): Promise<TokenConfig | undefined> {
    if (deps.getEndpointTokenConfig) {
      return deps.getEndpointTokenConfig(req, endpoint);
    }
    const endpointConfig = getCustomEndpointConfig({ endpoint, appConfig: req.config });
    const resolved = resolveSpeechEndpoint(req.config, endpoint);
    if (!endpointConfig || !resolved) {
      return undefined;
    }
    return resolveCustomEndpointTokenConfig({
      endpoint,
      endpointConfig,
      apiKey: resolved.apiKey,
      baseURL: resolved.baseURL,
      resolvedBaseURL: resolved.baseURL,
      userProvidesURL: isUserProvided(endpointConfig.baseURL ?? ''),
      appConfig: req.config,
      user: req.user,
    });
  }

  return {
    async run<T>(
      req: ServerRequest,
      config: Pick<TClipToolsConfig, 'wizard'>,
      model: WizardModel,
      job: LlmRun<T>,
    ) {
      const settings = config.wizard.llm;
      const target = resolveSpeechEndpoint(req.config, settings.endpoint);
      if (!target || !req.user?.id) {
        return { ok: false, code: 'unavailable' } as const;
      }
      let etc: TokenConfig | undefined;
      try {
        etc = await tokenConfig(req, settings.endpoint);
      } catch (error) {
        logger.warn('[clip] wizard model prices unavailable', getSafeErrorMetadata(error));
      }
      const rate = (tokenType: 'prompt' | 'completion') =>
        deps.getMultiplier({
          model: model.model,
          endpoint: settings.endpoint,
          tokenType,
          endpointTokenConfig: etc,
        });
      const promptRate = rate('prompt');
      const completionRate = rate('completion');
      const attempts = 1 + settings.repairAttempts;
      const promptText = job.system + job.turns.map((turn) => turn.content).join('');
      const held = Math.ceil(
        attempts * (tokensOf(promptText) * promptRate + settings.maxOutputTokens * completionRate),
      );
      const charge: MediaCharge = {
        model: model.model,
        endpoint: settings.endpoint,
        context: WIZARD_LLM_CONTEXT,
      };
      const hold = await deps.billing.hold(req, charge, held);
      if (hold === 'insufficient') {
        return { ok: false, code: 'insufficient_credit' } as const;
      }
      try {
        const messages: LlmTurn[] = [{ role: 'system', content: job.system }, ...job.turns];
        let promptTokens = 0;
        let completionTokens = 0;
        for (let attempt = 0; attempt < attempts; attempt++) {
          let content: string;
          try {
            const body: Record<string, unknown> = {
              model: model.model,
              messages,
              max_tokens: settings.maxOutputTokens,
              response_format: { type: 'json_object' },
              stream: false,
              user: req.user.id,
              ...(target.provider ? { provider: target.provider } : {}),
            };
            const response = await doFetch(
              `${target.baseURL.replace(/\/+$/, '')}/chat/completions`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...target.headers,
                  Authorization: `Bearer ${target.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(settings.timeoutMs),
              },
            );
            if (!response.ok) {
              logger.warn(`[clip] wizard model answered ${response.status}`);
              return { ok: false, code: 'provider_failed' } as const;
            }
            const payload = (await response.json()) as Completion;
            const text = payload.choices?.[0]?.message?.content;
            if (typeof text !== 'string' || !text.trim()) {
              return { ok: false, code: 'provider_failed' } as const;
            }
            content = text;
            const sent = messages.reduce((sum, turn) => sum + tokensOf(turn.content), 0);
            promptTokens += count(payload.usage?.prompt_tokens) ?? sent;
            completionTokens += count(payload.usage?.completion_tokens) ?? tokensOf(content);
          } catch (error) {
            logger.warn('[clip] wizard model call failed', getSafeErrorMetadata(error));
            return { ok: false, code: 'provider_failed' } as const;
          }
          const parsed = job.parse(content);
          if (parsed.ok) {
            const credits = Math.ceil(
              promptTokens * promptRate + completionTokens * completionRate,
            );
            await deps.billing.record(req, charge, credits);
            return { ok: true, value: parsed.value, credits } as const;
          }
          messages.push({ role: 'assistant', content }, { role: 'user', content: parsed.feedback });
        }
        return { ok: false, code: 'provider_failed' } as const;
      } finally {
        await hold?.release();
      }
    },
  };
}
