import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createHandler } from '../src/server.mjs';

const TOKEN = 'a'.repeat(64);

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
const urlOf = (server, path) => `http://127.0.0.1:${server.address().port}${path}`;

async function connect(server, path, headers) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(urlOf(server, path)), {
      requestInit: { headers: { 'X-Site-Mcp-Token': TOKEN, ...headers } },
    }),
  );
  return client;
}

/** A fake cPanel: records each UAPI call and answers with canned data. */
function fakeCpanel() {
  const calls = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    calls.push({
      path: parsed.pathname,
      method: init.method,
      auth: init.headers.Authorization,
      params: Object.fromEntries(
        init.method === 'GET' ? parsed.searchParams : new URLSearchParams(init.body),
      ),
    });
    const data = parsed.pathname.endsWith('/DomainInfo/list_domains')
      ? { main_domain: 'example.com', sub_domains: [] }
      : parsed.pathname.endsWith('/DNS/parse_zone')
        ? [
            {
              type: 'record',
              record_type: 'A',
              ttl: 300,
              dname_b64: Buffer.from('www').toString('base64'),
              data_b64: [Buffer.from('203.0.113.7').toString('base64')],
            },
            { type: 'comment', text_b64: '' },
          ]
        : [];
    return new Response(JSON.stringify({ status: 1, data, errors: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, fetch };
}

const CPANEL_HEADERS = {
  'X-Cpanel-Url': 'https://host.example.com:2083',
  'X-Cpanel-Username': 'exampleuser',
  'X-Cpanel-Token': 'ABCDEF0123456789ABCDEF0123456789',
};

test('cPanel: curated tools only, read tools marked read-only', async () => {
  const cpanel = fakeCpanel();
  const server = await listen(createHandler({ token: TOKEN, fetch: cpanel.fetch }));
  try {
    const client = await connect(server, '/cpanel/mcp', CPANEL_HEADERS);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes('list_domains') && names.includes('get_dns_zone'));
    for (const forbidden of ['create_cron_job', 'authorize_ssh_key', 'create_api_token']) {
      assert.ok(!names.includes(forbidden), forbidden);
    }
    const domains = tools.find((tool) => tool.name === 'list_domains');
    assert.equal(domains.annotations.readOnlyHint, true);
    const remove = tools.find((tool) => tool.name === 'delete_email_account');
    assert.equal(remove.annotations.destructiveHint, true);
    await client.close();
  } finally {
    server.close();
  }
});

test('cPanel: calls UAPI with the user’s token and decodes DNS records', async () => {
  const cpanel = fakeCpanel();
  const server = await listen(createHandler({ token: TOKEN, fetch: cpanel.fetch }));
  try {
    const client = await connect(server, '/cpanel/mcp', CPANEL_HEADERS);
    const domains = await client.callTool({ name: 'list_domains', arguments: {} });
    assert.equal(JSON.parse(domains.content[0].text).main_domain, 'example.com');
    assert.equal(cpanel.calls[0].path, '/execute/DomainInfo/list_domains');
    assert.equal(cpanel.calls[0].auth, `cpanel exampleuser:${CPANEL_HEADERS['X-Cpanel-Token']}`);

    const zone = await client.callTool({
      name: 'get_dns_zone',
      arguments: { domain: 'example.com' },
    });
    assert.deepEqual(JSON.parse(zone.content[0].text), [
      { name: 'www', type: 'A', ttl: 300, data: ['203.0.113.7'] },
    ]);
    await client.close();
  } finally {
    server.close();
  }
});

test('cPanel: a change without confirm: true never reaches cPanel', async () => {
  const cpanel = fakeCpanel();
  const server = await listen(createHandler({ token: TOKEN, fetch: cpanel.fetch }));
  try {
    const client = await connect(server, '/cpanel/mcp', CPANEL_HEADERS);
    const refused = await client
      .callTool({
        name: 'delete_email_account',
        arguments: { email: 'info', domain: 'example.com' },
      })
      .catch((error) => ({ isError: true, error }));
    assert.equal(refused.isError, true);
    const path = await client
      .callTool({ name: 'read_file', arguments: { dir: 'public_html/../../etc', file: 'passwd' } })
      .catch((error) => ({ isError: true, error }));
    assert.equal(path.isError, true);
    assert.equal(cpanel.calls.length, 0);

    const done = await client.callTool({
      name: 'delete_email_account',
      arguments: { email: 'info', domain: 'example.com', confirm: true },
    });
    assert.ok(!done.isError);
    assert.equal(cpanel.calls[0].method, 'POST');
    assert.deepEqual(cpanel.calls[0].params, { email: 'info', domain: 'example.com' });
    await client.close();
  } finally {
    server.close();
  }
});

test('refuses callers without the service token, other methods and bad site addresses', async () => {
  const server = await listen(createHandler({ token: TOKEN, fetch: fakeCpanel().fetch }));
  try {
    const anonymous = await fetch(urlOf(server, '/cpanel/mcp'), { method: 'POST', body: '{}' });
    assert.equal(anonymous.status, 401);
    const get = await fetch(urlOf(server, '/cpanel/mcp'), {
      headers: { 'X-Site-Mcp-Token': TOKEN },
    });
    assert.equal(get.status, 405);
    const privateSite = await fetch(urlOf(server, '/cpanel/mcp'), {
      method: 'POST',
      headers: {
        'X-Site-Mcp-Token': TOKEN,
        ...CPANEL_HEADERS,
        'X-Cpanel-Url': 'https://192.168.1.10:2083',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(privateSite.status, 400);
    assert.match((await privateSite.json()).error.message, /^blocked_address/);
    const health = await fetch(urlOf(server, '/health'));
    assert.equal(health.status, 200);
  } finally {
    server.close();
  }
});

test('WordPress: forwards the site’s tools and calls with the user’s application password', async () => {
  const seen = [];
  const site = await listen(async (req, res) => {
    seen.push(req.headers.authorization);
    if (req.url !== '/wp-json/mcp/mcp-adapter-default-server') {
      res.writeHead(404).end();
      return;
    }
    const mcp = new McpServer({ name: 'wp', version: '1' });
    mcp.registerTool(
      'mcp-adapter-discover-abilities',
      { description: 'Lists abilities', inputSchema: { category: z.string().optional() } },
      async () => ({ content: [{ type: 'text', text: '["core/get-site-info"]' }] }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
  const server = await listen(createHandler({ token: TOKEN, allowHttp: true, fetch }));
  try {
    const client = await connect(server, '/wordpress/mcp', {
      'X-Wordpress-Url': `http://localhost:${site.address().port}`,
      'X-Wordpress-Username': 'editor',
      'X-Wordpress-App-Password': 'abcd efgh ijkl mnop qrst uvwx',
    });
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['mcp-adapter-discover-abilities'],
    );
    const result = await client.callTool({ name: 'mcp-adapter-discover-abilities', arguments: {} });
    assert.equal(result.content[0].text, '["core/get-site-info"]');
    const expected = `Basic ${Buffer.from('editor:abcdefghijklmnopqrstuvwx').toString('base64')}`;
    assert.ok(seen.length > 0 && seen.every((value) => value === expected));
    await client.close();
  } finally {
    server.close();
    site.close();
  }
});

test('WordPress: a site without the MCP Adapter plugin says so', async () => {
  const site = await listen((req, res) => res.writeHead(404).end());
  const server = await listen(createHandler({ token: TOKEN, allowHttp: true, fetch }));
  try {
    const client = await connect(server, '/wordpress/mcp', {
      'X-Wordpress-Url': `http://localhost:${site.address().port}`,
      'X-Wordpress-Username': 'editor',
      'X-Wordpress-App-Password': 'abcd efgh ijkl mnop qrst uvwx',
    });
    await assert.rejects(client.listTools(), /no_mcp_adapter/);
    await client.close();
  } finally {
    server.close();
    site.close();
  }
});

test('NewsWatch: forwards with the user’s token, and says when it is not set up', async () => {
  const seen = [];
  const upstream = await listen(async (req, res) => {
    seen.push(req.headers.authorization);
    const mcp = new McpServer({ name: 'newswatch', version: '1' });
    mcp.registerTool(
      'latest_news',
      { description: 'Latest', inputSchema: {}, annotations: { readOnlyHint: true } },
      async () => ({ content: [{ type: 'text', text: '{"items":[]}' }] }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
  const token = `nwt_${'x'.repeat(43)}`;
  const env = { NEWSWATCH_MCP_URL: `http://localhost:${upstream.address().port}/mcp` };
  const server = await listen(createHandler({ token: TOKEN, allowHttp: true, fetch, env }));
  const unset = await listen(createHandler({ token: TOKEN, allowHttp: true, fetch, env: {} }));
  try {
    const client = await connect(server, '/newswatch/mcp', { 'X-Newswatch-Token': token });
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['latest_news'],
    );
    await client.callTool({ name: 'latest_news', arguments: {} });
    assert.ok(seen.length > 0 && seen.every((value) => value === `Bearer ${token}`));
    await client.close();

    await assert.rejects(
      connect(unset, '/newswatch/mcp', { 'X-Newswatch-Token': token }),
      /not_configured/,
    );
  } finally {
    server.close();
    unset.close();
    upstream.close();
  }
});
