import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SiteError, createSiteFetch, toSiteError } from './egress.mjs';

/**
 * What a failed upstream request means for the user. `messages` gives the text for a refused
 * login (401/403) and a missing endpoint (404); anything else is the connection's own error.
 */
export function describeUpstreamError(error, messages) {
  if (error instanceof SiteError && error.code !== 'unreachable') {
    return error;
  }
  const site = toSiteError(error);
  if (site.code !== 'unreachable') {
    return site;
  }
  const status = Number(error?.code ?? error?.cause?.code);
  if (status === 401 || status === 403) {
    return new SiteError('unauthorized', messages.unauthorized);
  }
  if (status === 404) {
    return new SiteError(messages.notFoundCode ?? 'not_found', messages.notFound);
  }
  return site;
}

const asText = (site) =>
  site.message.startsWith(`${site.code}:`) ? site.message : `${site.code}: ${site.message}`;

/** Connects to the upstream MCP server with the user's own `Authorization`. */
async function connectUpstream({ endpoint, authorization }, options) {
  const transport = new StreamableHTTPClientTransport(endpoint, {
    fetch: options.fetch ?? createSiteFetch(),
    requestInit: { headers: { Authorization: authorization } },
  });
  const client = new Client({ name: 'hivegpt-site-mcp', version: '1.0.0' });
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return client;
}

/**
 * Re-exposes an upstream MCP server's tools on a low-level `server` created with the `tools`
 * capability. The list and each call are forwarded with the user's own credentials, so the
 * upstream's permissions apply; nothing is cached between requests.
 */
export function registerProxy(server, upstream, options = {}, messages) {
  const withClient = async (work) => {
    let client;
    try {
      client = await connectUpstream(upstream, options);
      return await work(client);
    } catch (error) {
      const site = describeUpstreamError(error, messages);
      throw new SiteError(site.code, asText(site));
    } finally {
      await client?.close().catch(() => {});
    }
  };
  server.setRequestHandler(ListToolsRequestSchema, async () =>
    withClient(async (client) => {
      const { tools } = await client.listTools();
      return { tools };
    }),
  );
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await withClient((client) =>
        client.callTool({
          name: request.params.name,
          arguments: request.params.arguments ?? {},
        }),
      );
    } catch (error) {
      const site = error instanceof SiteError ? error : describeUpstreamError(error, messages);
      return { isError: true, content: [{ type: 'text', text: asText(site) }] };
    }
  });
}
