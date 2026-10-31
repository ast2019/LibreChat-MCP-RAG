import path from 'path';
import express from 'express';
import request from 'supertest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { AppConfig } from '@librechat/data-schemas';
import type { ToolCall } from '~/agents/openai/types';
import { buildNonStreamingResponse } from '~/agents/openai/service';
import { createApiRequestLimiter } from '~/apiKeys/rateLimit';
import { listApiModelSpecs } from '~/apiKeys/models';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

/** The committed document, as `/api/openapi.json` serves it. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const spec = require(path.resolve(__dirname, '../../openapi/agents.openapi.json'));

/** Validates a body against the documented response of one path, method and status. */
/** Checks a body against the documented response of one path, method and status. */
function checkAgainstSpec(routePath: string, method: string, status: number, body: unknown) {
  const escaped = routePath.replace(/~/g, '~0').replace(/\//g, '~1');
  const pointer = `#/paths/${escaped}/${method}/responses/${status}/content/application~1json/schema`;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile({ ...spec, $ref: pointer });
  const valid = validate(body);
  return { errors: validate.errors, valid };
}

const MATCHES = { errors: null, valid: true };

describe('the inference endpoints in the OpenAPI document', () => {
  it('documents every model-calling route with the API-key scheme', () => {
    for (const [route, method] of [
      ['/models', 'get'],
      ['/models/{model}', 'get'],
      ['/chat/completions', 'post'],
      ['/responses', 'post'],
      ['/responses/models', 'get'],
      ['/responses/{id}', 'get'],
      ['/events', 'post'],
      ['/events/bindings', 'post'],
      ['/events/{id}', 'get'],
    ]) {
      expect(spec.paths[route]?.[method]?.security).toEqual([{ apiKey: [] }]);
    }
    expect(
      Object.keys(spec.paths['/chat/completions'].post.responses['200'].content).sort(),
    ).toEqual(['application/json', 'text/event-stream']);
  });

  it('matches a completion that hands tool calls back to the caller', () => {
    const toolCalls = new Map<number, ToolCall>([
      [
        0,
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
        },
      ],
    ]);
    const body = buildNonStreamingResponse(
      { requestId: 'chatcmpl-1', created: 1, model: 'smart' },
      '',
      '',
      toolCalls,
      { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      true,
    );
    expect(checkAgainstSpec('/chat/completions', 'post', 200, body)).toEqual(MATCHES);
  });

  it('matches the model list', () => {
    const config = {
      modelSpecs: {
        list: [
          {
            name: 'local',
            label: 'Local',
            group: 'Local',
            privacy: 'local',
            preset: { endpoint: 'Local', model: 'qwen' },
          },
        ],
      },
    };
    expect(
      checkAgainstSpec('/models', 'get', 200, {
        object: 'list',
        data: listApiModelSpecs({ config } as never),
      }),
    ).toEqual(MATCHES);
  });

  it('matches the rate-limit refusal', async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.assign(req, {
        user: { id: 'u' },
        config: { rateLimits: { api: { userMax: 1 } } } as unknown as AppConfig,
      });
      next();
    });
    app.post('/chat/completions', createApiRequestLimiter(), (_req, res) => {
      res.json({});
    });
    await request(app).post('/chat/completions');
    const refused = await request(app).post('/chat/completions').expect(429);
    expect(checkAgainstSpec('/chat/completions', 'post', 429, refused.body)).toEqual(MATCHES);
  });
});
