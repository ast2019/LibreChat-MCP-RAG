import { EModelEndpoint } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import {
  buildCustomEndpointAuthDiagnostics,
  describeBaseUrlHost,
  describeSecretValue,
  fingerprintSecret,
  formatEndpointAuthRejectionMessage,
} from './authDiagnostics';

describe('custom endpoint auth diagnostics', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CLAUDE_TIME_KEY;
    delete process.env.CLAUDE_TIME_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const appConfig = {
    endpoints: {
      custom: [
        {
          name: 'ClaudeTime',
          provider: EModelEndpoint.anthropic,
          apiKey: '${CLAUDE_TIME_KEY}',
          baseURL: '${CLAUDE_TIME_BASE_URL}',
        },
      ],
    },
  } as unknown as AppConfig;

  it('fingerprints without exposing the secret', () => {
    const value = 'sk-ant-claudetime-secret-value';
    const described = describeSecretValue(value, 'CLAUDE_TIME_KEY');
    expect(described).toEqual({
      present: true,
      length: value.length,
      fingerprint: fingerprintSecret(value),
      env: 'CLAUDE_TIME_KEY',
    });
    expect(JSON.stringify(described)).not.toContain(value);
  });

  it('reports host only for baseURL', () => {
    expect(
      describeBaseUrlHost('https://gateway.example.com/v1/secret-path?token=x', 'CLAUDE_TIME_BASE_URL'),
    ).toEqual({
      present: true,
      host: 'gateway.example.com',
      env: 'CLAUDE_TIME_BASE_URL',
    });
  });

  it('builds ClaudeTime diagnostics from env without leaking secrets', () => {
    process.env.CLAUDE_TIME_KEY = 'sk-ant-gateway-key';
    process.env.CLAUDE_TIME_BASE_URL = 'https://claudetime.gateway.example/private';

    const diagnostics = buildCustomEndpointAuthDiagnostics({
      endpoint: 'ClaudeTime',
      appConfig,
    });

    expect(diagnostics).toMatchObject({
      endpoint: 'ClaudeTime',
      failureKind: 'endpoint_credential_rejected',
      notTimePackRequired: true,
      sdkProvider: EModelEndpoint.anthropic,
      apiKey: {
        present: true,
        length: 'sk-ant-gateway-key'.length,
        fingerprint: fingerprintSecret('sk-ant-gateway-key'),
        env: 'CLAUDE_TIME_KEY',
      },
      baseURL: {
        present: true,
        host: 'claudetime.gateway.example',
        env: 'CLAUDE_TIME_BASE_URL',
      },
    });
    expect(JSON.stringify(diagnostics)).not.toContain('sk-ant-gateway-key');
    expect(JSON.stringify(diagnostics)).not.toContain('/private');
  });

  it('marks unset ClaudeTime env as absent', () => {
    const diagnostics = buildCustomEndpointAuthDiagnostics({
      endpoint: 'ClaudeTime',
      appConfig,
    });
    expect(diagnostics?.apiKey).toMatchObject({
      present: false,
      length: 0,
      fingerprint: '',
      env: 'CLAUDE_TIME_KEY',
    });
    expect(diagnostics?.baseURL).toMatchObject({
      present: false,
      host: null,
      env: 'CLAUDE_TIME_BASE_URL',
    });
  });

  it('formats a debug-share-visible rejection line', () => {
    process.env.CLAUDE_TIME_KEY = 'sk-ant-bad';
    process.env.CLAUDE_TIME_BASE_URL = 'https://wrong.example';
    const diagnostics = buildCustomEndpointAuthDiagnostics({
      endpoint: 'ClaudeTime',
      appConfig,
    });
    expect(diagnostics).not.toBeNull();
    const message = formatEndpointAuthRejectionMessage(diagnostics!);
    expect(message).toContain('[ClaudeTime] Upstream 401');
    expect(message).toContain('NOT time_pack_required');
    expect(message).toContain('CLAUDE_TIME_KEY');
    expect(message).toContain('present=true');
    expect(message).toContain('host=wrong.example');
    expect(message).not.toContain('sk-ant-bad');
  });
});
