import { getOAuthCallbackUrl, preferPublicHttpsBaseUrl } from './url';

describe('preferPublicHttpsBaseUrl', () => {
  it.each([
    ['https://server.example', 'https://server.example'],
    ['https://server.example/', 'https://server.example'],
    ['http://localhost:3080', 'http://localhost:3080'],
    ['http://localhost:3080/', 'http://localhost:3080'],
    ['http://127.0.0.1:3080', 'http://127.0.0.1:3080'],
    ['http://[::1]:3080', 'http://[::1]:3080'],
    ['http://app.localhost:3080', 'http://app.localhost:3080'],
    ['http://hivelink.co', 'https://hivelink.co'],
    ['http://hivelink.co/', 'https://hivelink.co'],
    ['http://hivelink.co:80', 'https://hivelink.co'],
    ['http://chat.example.com/librechat/', 'https://chat.example.com/librechat'],
  ])('maps %s to %s', (input, expected) => {
    expect(preferPublicHttpsBaseUrl(input)).toBe(expected);
  });
});

describe('getOAuthCallbackUrl', () => {
  it.each([
    ['https://server.example', 'https://server.example'],
    ['https://server.example/', 'https://server.example'],
    ['https://server.example///', 'https://server.example'],
    ['https://server.example/chat', 'https://server.example/chat'],
    ['https://server.example/chat/', 'https://server.example/chat'],
    ['https://server.example/chat///', 'https://server.example/chat'],
    ['https://server.example/apps/librechat/', 'https://server.example/apps/librechat'],
    ['http://hivelink.co', 'https://hivelink.co'],
    ['http://hivelink.co/', 'https://hivelink.co'],
    ['http://localhost:3080', 'http://localhost:3080'],
  ])('joins %s to callback paths without duplicate slashes', (baseUrl, expected) => {
    for (const callbackPath of [
      '/api/mcp/test-server/oauth/callback',
      '/api/mcp/oauth/callback',
      '/api/actions/test-action/oauth/callback',
    ]) {
      expect(getOAuthCallbackUrl(baseUrl, callbackPath)).toBe(`${expected}${callbackPath}`);
    }
  });
});
