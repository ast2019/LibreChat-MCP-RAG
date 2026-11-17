import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from '../src/server.mjs';

const TOKEN = 't'.repeat(40);

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(port);
    });
  });

test('health is public; render needs the bearer token', async () => {
  const server = createServer({ token: TOKEN });
  const port = await listen(server);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const denied = await fetch(`http://127.0.0.1:${port}/render`, { method: 'POST' });
    assert.equal(denied.status, 401);
  } finally {
    server.close();
  }
});
