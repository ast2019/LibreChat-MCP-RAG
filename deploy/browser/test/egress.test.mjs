import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, test } from 'node:test';
import { createEgressProxy } from '../src/egress.mjs';

const listen = (server, host = '127.0.0.1') =>
  new Promise((resolve) => server.listen(0, host, () => resolve(server.address().port)));

let target;
let targetPort;
let proxy;
let proxyPort;
const blocked = [];

before(async () => {
  target = http.createServer((req, res) => res.end(`hello ${req.headers.host}`));
  targetPort = await listen(target);
  /* The test policy treats 127.0.0.1 as public and nothing else, on the target's port only;
     `shop.test` resolves there. */
  proxy = createEgressProxy({
    lookup: async (host) => (host === 'shop.test' ? [{ address: '127.0.0.1' }] : []),
    isAllowed: (address) => address === '127.0.0.1',
    ports: [targetPort],
    onBlocked: (event) => blocked.push(event),
  });
  proxyPort = await listen(proxy);
});

after(() => {
  target.close();
  proxy.close();
});

const viaProxy = (url) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: url, method: 'GET' });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

const connect = (authority) =>
  new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1', () =>
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
    );
    socket.once('data', (data) => {
      resolve(data.toString().split('\r\n')[0]);
      socket.destroy();
    });
    socket.on('error', reject);
  });

test('plain requests reach an allowed address and keep the Host header', async () => {
  const response = await viaProxy(`http://shop.test:${targetPort}/page`);
  assert.equal(response.status, 200);
  assert.equal(response.body, `hello shop.test:${targetPort}`);
  /* A name that resolves to nothing is refused rather than tried. */
  assert.equal((await viaProxy(`http://nowhere.test:${targetPort}/`)).status, 403);
});

test('plain requests to a refused address or port get 403', async () => {
  assert.equal((await viaProxy(`http://127.0.0.2:${targetPort}/`)).status, 403);
  assert.equal((await viaProxy(`http://127.0.0.1:${targetPort + 1}/`)).status, 403);
  assert.ok(blocked.some((event) => event.host === '127.0.0.2'));
});

test('CONNECT tunnels only to allowed addresses and ports', async () => {
  assert.match(await connect(`127.0.0.1:${targetPort}`), /200 Connection Established/);
  assert.match(await connect(`127.0.0.2:${targetPort}`), /403/);
  assert.match(await connect('127.0.0.1:22'), /403/);
  assert.match(await connect('[::1]:443'), /403/);
});
