import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import { WEB_PORTS, isPublicAddress } from './address.mjs';

const CONNECT_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 120_000;
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
];

/**
 * Resolves a host and returns one address to connect to, or throws `blocked_address` when the
 * name points anywhere private. Every record must be public: a name with one public and one
 * private record would otherwise pass the check and still reach the private one.
 */
export async function resolvePublic(
  host,
  { lookup = dns.lookup, isAllowed = isPublicAddress } = {},
) {
  const name = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const records = net.isIP(name)
    ? [{ address: name }]
    : await lookup(name, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => !isAllowed(record.address))) {
    throw Object.assign(new Error(`${host} is not a public address`), { code: 'blocked_address' });
  }
  return records[0].address;
}

/** `host:port` of a CONNECT request, or null for anything malformed. */
function readAuthority(value) {
  const match = /^(\[[0-9a-fA-F:.]+\]|[^:\s/]+):(\d{1,5})$/.exec(value ?? '');
  if (!match) {
    return null;
  }
  return { host: match[1], port: Number(match[2]) };
}

function refuse(socket, status, reason) {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}

/**
 * The only way out for Chromium: an HTTP proxy on loopback that connects to the address it
 * resolved itself, so a page cannot reach this host, the Docker networks or the cloud metadata
 * service, even through DNS that changes its answer between a check and the connection.
 */
export function createEgressProxy({
  lookup = dns.lookup,
  isAllowed = isPublicAddress,
  ports = WEB_PORTS,
  connect = net.connect,
  onBlocked = () => {},
} = {}) {
  const resolve = (host) => resolvePublic(host, { lookup, isAllowed });
  const server = http.createServer();

  server.on('connect', async (req, client, head) => {
    client.on('error', () => client.destroy());
    const target = readAuthority(req.url);
    if (!target || !ports.includes(target.port)) {
      onBlocked({ host: target?.host ?? String(req.url), reason: 'port' });
      return refuse(client, 403, 'Forbidden');
    }
    let address;
    try {
      address = await resolve(target.host);
    } catch (error) {
      onBlocked({ host: target.host, reason: error.code ?? 'dns' });
      return refuse(client, error.code === 'blocked_address' ? 403 : 502, 'Forbidden');
    }
    const upstream = connect({ host: address, port: target.port, timeout: CONNECT_TIMEOUT_MS });
    upstream.once('connect', () => {
      upstream.setTimeout(IDLE_TIMEOUT_MS);
      client.setTimeout(IDLE_TIMEOUT_MS);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) {
        upstream.write(head);
      }
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const fail = () => {
      refuse(client, 502, 'Bad Gateway');
      upstream.destroy();
    };
    upstream.on('timeout', fail);
    upstream.on('error', fail);
    client.on('timeout', () => {
      client.destroy();
      upstream.destroy();
    });
    client.on('close', () => upstream.destroy());
  });

  server.on('request', async (req, res) => {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const port = Number(url.port || 80);
    if (url.protocol !== 'http:' || !ports.includes(port)) {
      onBlocked({ host: url.hostname, reason: 'port' });
      res.writeHead(403).end();
      return;
    }
    let address;
    try {
      address = await resolve(url.hostname);
    } catch (error) {
      onBlocked({ host: url.hostname, reason: error.code ?? 'dns' });
      res.writeHead(error.code === 'blocked_address' ? 403 : 502).end();
      return;
    }
    const headers = { ...req.headers };
    for (const name of HOP_BY_HOP) {
      delete headers[name];
    }
    /* The target URL decides the host, not a Host header that may disagree with it. */
    headers.host = url.host;
    const upstream = http.request({
      host: address,
      port,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers,
      setHost: false,
      timeout: CONNECT_TIMEOUT_MS,
    });
    upstream.on('response', (response) => {
      const forwarded = { ...response.headers };
      for (const name of HOP_BY_HOP) {
        delete forwarded[name];
      }
      res.writeHead(response.statusCode ?? 502, forwarded);
      response.pipe(res);
    });
    const fail = () => {
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end();
      upstream.destroy();
    };
    upstream.on('timeout', fail);
    upstream.on('error', fail);
    req.pipe(upstream);
  });

  server.on('clientError', (_error, socket) => refuse(socket, 400, 'Bad Request'));
  return server;
}
