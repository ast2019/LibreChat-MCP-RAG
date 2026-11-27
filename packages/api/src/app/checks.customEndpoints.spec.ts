import { AuthType } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { checkCustomEndpointCredentials } from './checks';
import { logger } from '@librechat/data-schemas';

describe('checkCustomEndpointCredentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CLAUDE_TIME_KEY;
    delete process.env.CLAUDE_TIME_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const withCustom = (endpoints: Array<Record<string, unknown>>): AppConfig =>
    ({ endpoints: { custom: endpoints } }) as unknown as AppConfig;

  it('does nothing when no custom endpoints are configured', () => {
    checkCustomEndpointCredentials(undefined);
    checkCustomEndpointCredentials({ endpoints: {} } as AppConfig);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('errors when ClaudeTime env placeholders are unset', () => {
    checkCustomEndpointCredentials(
      withCustom([
        {
          name: 'ClaudeTime',
          provider: 'anthropic',
          apiKey: '${CLAUDE_TIME_KEY}',
          baseURL: '${CLAUDE_TIME_BASE_URL}',
        },
      ]),
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('CLAUDE_TIME_KEY'),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('CLAUDE_TIME_BASE_URL'),
    );
  });

  it('errors when the env var is set but empty', () => {
    process.env.CLAUDE_TIME_KEY = '   ';
    process.env.CLAUDE_TIME_BASE_URL = 'https://gateway.example.com';

    checkCustomEndpointCredentials(
      withCustom([
        {
          name: 'ClaudeTime',
          apiKey: '${CLAUDE_TIME_KEY}',
          baseURL: '${CLAUDE_TIME_BASE_URL}',
        },
      ]),
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('CLAUDE_TIME_KEY'));
  });

  it('stays quiet when both env vars are set', () => {
    process.env.CLAUDE_TIME_KEY = 'sk-ant-test';
    process.env.CLAUDE_TIME_BASE_URL = 'https://gateway.example.com';

    checkCustomEndpointCredentials(
      withCustom([
        {
          name: 'ClaudeTime',
          apiKey: '${CLAUDE_TIME_KEY}',
          baseURL: '${CLAUDE_TIME_BASE_URL}',
        },
      ]),
    );

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('skips user_provided credential placeholders', () => {
    process.env.MY_USER_KEY = AuthType.USER_PROVIDED;

    checkCustomEndpointCredentials(
      withCustom([
        {
          name: 'BringYourOwn',
          apiKey: '${MY_USER_KEY}',
          baseURL: 'https://api.example.com',
        },
      ]),
    );

    expect(logger.error).not.toHaveBeenCalled();
  });
});
