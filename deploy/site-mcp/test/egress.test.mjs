import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { Agent } from 'undici';
import { createSiteFetch, publicLookup, readSiteUrl } from '../src/egress.mjs';

const ports = [2083, 443];

test('accepts an https site on an allowed port', () => {
  assert.equal(
    readSiteUrl('https://example.com:2083', { ports }).origin,
    'https://example.com:2083',
  );
  assert.equal(readSiteUrl(' https://example.com ', { ports }).hostname, 'example.com');
});

test('refuses http, other ports, credentials, queries and private literal addresses', () => {
  const codes = [
    'http://example.com:2083',
    'https://example.com:22',
    'https://user:pass@example.com',
    'https://example.com/?a=1',
    'https://127.0.0.1:2083',
    'https://10.0.4.8',
    'https://[::1]',
    'https://[::ffff:192.168.1.1]',
    'https://169.254.169.254',
    'not a url',
  ].map((value) => {
    try {
      readSiteUrl(value, { ports });
      return 'accepted';
    } catch (error) {
      return error.code;
    }
  });
  assert.ok(!codes.includes('accepted'), codes.join(','));
  assert.equal(codes[4], 'blocked_address');
});

test('refuses names that resolve to private addresses', async () => {
  const error = await new Promise((resolve) =>
    publicLookup('localhost', {}, (err) => resolve(err)),
  );
  assert.equal(error?.code, 'blocked_address');
});

test('does not follow redirects', async () => {
  const site = http.createServer((req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/' });
    res.end();
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  try {
    const fetch = createSiteFetch({ dispatcher: new Agent() });
    await assert.rejects(fetch(`http://127.0.0.1:${site.address().port}/`), { code: 'redirected' });
  } finally {
    site.close();
  }
});

test('refuses to connect to a private address through the default agent', async () => {
  await assert.rejects(createSiteFetch()('https://localhost/'), { code: 'blocked_address' });
});
