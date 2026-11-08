import type { IUser } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import { createUserPreferencesHandler } from './preferences';

interface MockResponse extends Partial<Response> {
  statusCode: number;
  body?: object;
  status: jest.Mock;
  json: jest.Mock;
}

function createResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 200,
    status: jest.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: jest.fn((body: object) => {
      response.body = body;
      return response;
    }),
  };
  return response;
}

function createRequest(body: object, authenticated = true): Request & { user?: Partial<IUser> } {
  return {
    body,
    user: authenticated ? { id: 'user-1' } : undefined,
  } as Request & { user?: Partial<IUser> };
}

describe('createUserPreferencesHandler', () => {
  it.each(['user', 'agent-user', 'conversation'] as const)(
    'persists the %s stateful workspace default',
    async (statefulCodeEnvironment) => {
      const updateStatefulCodeEnvironment = jest.fn().mockResolvedValue({
        personalization: { statefulCodeEnvironment },
      });
      const handler = createUserPreferencesHandler({ updateStatefulCodeEnvironment });
      const response = createResponse();

      await handler(
        createRequest({ statefulCodeEnvironment }) as Parameters<typeof handler>[0],
        response as Response,
      );

      expect(updateStatefulCodeEnvironment).toHaveBeenCalledWith('user-1', statefulCodeEnvironment);
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        updated: true,
        preferences: { statefulCodeEnvironment },
      });
    },
  );

  it('rejects an invalid stateful workspace default', async () => {
    const updateStatefulCodeEnvironment = jest.fn();
    const handler = createUserPreferencesHandler({ updateStatefulCodeEnvironment });
    const response = createResponse();

    await handler(
      createRequest({ statefulCodeEnvironment: 'agent' }) as Parameters<typeof handler>[0],
      response as Response,
    );

    expect(updateStatefulCodeEnvironment).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
  });

  it('rejects a valid scope excluded by deployment policy', async () => {
    const updateStatefulCodeEnvironment = jest.fn();
    const handler = createUserPreferencesHandler({ updateStatefulCodeEnvironment });
    const response = createResponse();
    const request = createRequest({ statefulCodeEnvironment: 'conversation' }) as Parameters<
      typeof handler
    >[0];
    request.config = {
      endpoints: {
        agents: {
          statefulCodeSessions: { allowedEnvironments: ['user', 'agent-user'] },
        },
      },
    } as NonNullable<typeof request.config>;

    await handler(request, response as Response);

    expect(updateStatefulCodeEnvironment).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
  });

  it('requires an authenticated user', async () => {
    const updateStatefulCodeEnvironment = jest.fn();
    const handler = createUserPreferencesHandler({ updateStatefulCodeEnvironment });
    const response = createResponse();

    await handler(
      createRequest({ statefulCodeEnvironment: 'user' }, false) as Parameters<typeof handler>[0],
      response as Response,
    );

    expect(updateStatefulCodeEnvironment).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
  });

  it('returns not found when the user no longer exists', async () => {
    const updateStatefulCodeEnvironment = jest.fn().mockResolvedValue(null);
    const handler = createUserPreferencesHandler({ updateStatefulCodeEnvironment });
    const response = createResponse();

    await handler(
      createRequest({ statefulCodeEnvironment: 'user' }) as Parameters<typeof handler>[0],
      response as Response,
    );

    expect(response.statusCode).toBe(404);
  });

  describe('imageModel', () => {
    const imageConfig = {
      config: {
        mediaGeneration: {
          enabled: true,
          image: { model: 'openai/gpt-image-2', catalogue: true, exclude: ['recraft/*'] },
        },
      },
    } as never;
    const imageCatalogue = () => [
      { id: 'openai/gpt-image-2', acceptsImages: true },
      { id: 'black-forest-labs/flux.2-pro', acceptsImages: true },
      { id: 'recraft/recraft-v4', acceptsImages: false },
    ];
    const handlerWith = (updateImageModel: jest.Mock) =>
      createUserPreferencesHandler({
        updateStatefulCodeEnvironment: jest.fn(),
        updateImageModel,
        imageCatalogue,
      });
    type HandlerRequest = Parameters<ReturnType<typeof handlerWith>>[0];
    const request = (body: object): HandlerRequest => {
      const req = createRequest(body) as HandlerRequest;
      req.config = imageConfig;
      return req;
    };

    it('saves a model the deployment offers, on its own', async () => {
      const updateImageModel = jest.fn().mockResolvedValue({
        personalization: { imageModel: 'black-forest-labs/flux.2-pro' },
      });
      const handler = handlerWith(updateImageModel);
      const response = createResponse();

      await handler(request({ imageModel: 'black-forest-labs/flux.2-pro' }), response as Response);

      expect(updateImageModel).toHaveBeenCalledWith('user-1', 'black-forest-labs/flux.2-pro');
      expect(response.body).toEqual({
        updated: true,
        preferences: { imageModel: 'black-forest-labs/flux.2-pro' },
      });
    });

    it('refuses an excluded or unknown model and a value that is not an id', async () => {
      const updateImageModel = jest.fn();
      const handler = handlerWith(updateImageModel);
      for (const [imageModel, status] of [
        ['recraft/recraft-v4', 403],
        ['someone/else', 403],
        ['', 400],
        [42, 400],
      ] as const) {
        const response = createResponse();
        await handler(request({ imageModel }), response as Response);
        expect(response.statusCode).toBe(status);
      }
      expect(updateImageModel).not.toHaveBeenCalled();
    });
  });
});
