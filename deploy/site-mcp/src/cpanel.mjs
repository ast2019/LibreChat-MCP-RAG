import { z } from 'zod';
import { SiteError, createSiteFetch, readSiteUrl } from './egress.mjs';

/** cPanel's own port, and 443 for hosts that proxy cPanel on the standard port. */
export const CPANEL_PORTS = Object.freeze([2083, 443]);
const MAX_TEXT = 60_000;
const MAX_FILE_CHARS = 100_000;

const USERNAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
const TOKEN = /^[A-Za-z0-9]{16,128}$/;
const DOMAIN = z
  .string()
  .min(3)
  .max(253)
  .regex(/^(?!-)[a-z0-9.-]+\.[a-z]{2,}$/i, 'A domain name such as example.com');
const LOCAL_PART = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9._+-]+$/i, 'The part before @, e.g. info');
/** A path inside the account's home directory, never escaping it. */
const HOME_PATH = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !value.split('/').includes('..') && !value.includes('\0'), {
    message: 'The path may not contain ".."',
  });
const FILE_NAME = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('/') && value !== '..' && !value.includes('\0'), {
    message: 'A file name without "/"',
  });
const PASSWORD = z.string().min(12).max(128);
const CONFIRM = z
  .literal(true)
  .describe('Must be true, and only after the user explicitly confirmed this change.');

/** The account the request acts on, from headers the api service fills from the user's values. */
export function readCpanelCredentials(headers, { allowHttp = false } = {}) {
  const url = readSiteUrl(headers['x-cpanel-url'], { ports: CPANEL_PORTS, allowHttp });
  const username = String(headers['x-cpanel-username'] ?? '').trim();
  const token = String(headers['x-cpanel-token'] ?? '').trim();
  if (!USERNAME.test(username)) {
    throw new SiteError('invalid_username', 'The cPanel username is not valid.');
  }
  if (!TOKEN.test(token)) {
    throw new SiteError('invalid_token', 'The cPanel API token is not valid.');
  }
  return { base: `${url.origin}`, username, token };
}

/** Calls one UAPI function and returns its `data`; cPanel's own errors become a SiteError. */
export async function callUapi(credentials, module, fn, params = {}, options = {}) {
  const fetch = options.fetch ?? createSiteFetch();
  const method = options.method ?? 'GET';
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      query.append(key, String(value));
    }
  }
  const endpoint = `${credentials.base}/execute/${module}/${fn}`;
  const response = await fetch(method === 'GET' ? `${endpoint}?${query}` : endpoint, {
    method,
    headers: {
      Authorization: `cpanel ${credentials.username}:${credentials.token}`,
      Accept: 'application/json',
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    ...(method === 'GET' ? {} : { body: query.toString() }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new SiteError('unauthorized', 'cPanel refused the username or API token.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new SiteError('bad_response', `cPanel answered with HTTP ${response.status}, not JSON.`);
  }
  if (!response.ok || body?.status !== 1) {
    const errors = Array.isArray(body?.errors) ? body.errors.filter(Boolean).join(' ') : '';
    throw new SiteError('cpanel_error', errors.slice(0, 500) || `cPanel error ${response.status}`);
  }
  return body.data;
}

const decode = (value) => {
  try {
    return Buffer.from(String(value ?? ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
};

const pick = (row, keys) =>
  Object.fromEntries(keys.filter((key) => row?.[key] !== undefined).map((key) => [key, row[key]]));

const list = (value) => (Array.isArray(value) ? value : []);

/**
 * The curated tools: reading the account, email accounts, files and a few safe actions. No
 * cron, SSH keys, API tokens, Git deploy, database changes or DNS edits (they can run code or
 * take the account over), and every change asks for `confirm: true`.
 */
export const CPANEL_TOOLS = [
  {
    name: 'get_account_info',
    description: 'The cPanel account: main domain, plan, contact email and limits.',
    readOnly: true,
    input: {},
    run: (api) => api('Variables', 'get_user_information'),
  },
  {
    name: 'get_disk_usage',
    description: 'Disk space used and the quota of the account.',
    readOnly: true,
    input: {},
    run: (api) => api('Quota', 'get_quota_info'),
  },
  {
    name: 'list_domains',
    description: 'The main domain, addon domains, subdomains and parked domains.',
    readOnly: true,
    input: {},
    run: (api) => api('DomainInfo', 'list_domains'),
  },
  {
    name: 'list_email_accounts',
    description: 'Email accounts with their disk use and quota.',
    readOnly: true,
    input: { domain: DOMAIN.optional() },
    run: async (api, { domain }) =>
      list(await api('Email', 'list_pops_with_disk', { domain })).map((row) =>
        pick(row, ['email', 'domain', 'user', 'diskused', 'diskquota', 'suspended_login']),
      ),
  },
  {
    name: 'list_email_forwarders',
    description: 'Email forwarders (where mail to an address is sent on).',
    readOnly: true,
    input: { domain: DOMAIN.optional() },
    run: async (api, { domain }) =>
      list(await api('Email', 'list_forwarders', { domain })).map((row) =>
        pick(row, ['dest', 'forward']),
      ),
  },
  {
    name: 'get_dns_zone',
    description: 'The DNS records of one domain of the account (read only).',
    readOnly: true,
    input: { domain: DOMAIN },
    run: async (api, { domain }) =>
      list(await api('DNS', 'parse_zone', { zone: domain }))
        .filter((row) => row?.type === 'record')
        .slice(0, 300)
        .map((row) => ({
          name: decode(row.dname_b64),
          type: row.record_type,
          ttl: row.ttl,
          data: list(row.data_b64).map(decode),
        })),
  },
  {
    name: 'list_ssl_certificates',
    description: 'The SSL certificates installed on the account’s sites and when they expire.',
    readOnly: true,
    input: {},
    run: async (api) =>
      list(await api('SSL', 'installed_hosts')).map((row) => ({
        servername: row?.servername,
        domains: row?.certificate?.domains,
        not_after: row?.certificate?.not_after,
        issuer: row?.certificate?.['issuer.organizationName'],
        is_self_signed: row?.certificate?.is_self_signed,
      })),
  },
  {
    name: 'list_files',
    description: 'Files and folders in one folder of the account, e.g. public_html.',
    readOnly: true,
    input: { dir: HOME_PATH.describe('Folder inside the home directory, e.g. public_html') },
    run: async (api, { dir }) =>
      list(await api('Fileman', 'list_files', { dir, include_mime: 0 }))
        .slice(0, 500)
        .map((row) => pick(row, ['file', 'type', 'size', 'humansize', 'mtime'])),
  },
  {
    name: 'read_file',
    description: 'The text of one file (the first 100,000 characters).',
    readOnly: true,
    input: { dir: HOME_PATH, file: FILE_NAME },
    run: async (api, { dir, file }) => {
      const data = await api('Fileman', 'get_file_content', { dir, file });
      const content = String(data?.content ?? '');
      return {
        dir,
        file,
        truncated: content.length > MAX_FILE_CHARS,
        content: content.slice(0, MAX_FILE_CHARS),
      };
    },
  },
  {
    name: 'list_databases',
    description: 'MySQL databases of the account, their size and users.',
    readOnly: true,
    input: {},
    run: async (api) =>
      list(await api('Mysql', 'list_databases')).map((row) =>
        pick(row, ['database', 'disk_usage', 'users']),
      ),
  },
  {
    name: 'list_backups',
    description: 'Full backups stored in the home directory.',
    readOnly: true,
    input: {},
    run: (api) => api('Backup', 'list_backups'),
  },
  {
    name: 'create_email_account',
    description: 'Creates an email account. Ask the user for the password; never invent one.',
    readOnly: false,
    destructive: false,
    input: {
      email: LOCAL_PART,
      domain: DOMAIN,
      password: PASSWORD,
      quota_mb: z.number().int().min(0).max(102_400).default(1024),
      confirm: CONFIRM,
    },
    run: async (api, { email, domain, password, quota_mb }) => {
      await api('Email', 'add_pop', { email, domain, password, quota: quota_mb }, 'POST');
      return { created: `${email}@${domain}`, quota_mb };
    },
  },
  {
    name: 'change_email_password',
    description: 'Sets a new password for an email account.',
    readOnly: false,
    destructive: true,
    input: { email: LOCAL_PART, domain: DOMAIN, password: PASSWORD, confirm: CONFIRM },
    run: async (api, { email, domain, password }) => {
      await api('Email', 'passwd_pop', { email, domain, password }, 'POST');
      return { changed: `${email}@${domain}` };
    },
  },
  {
    name: 'delete_email_account',
    description: 'Deletes an email account and its mail. Cannot be undone.',
    readOnly: false,
    destructive: true,
    input: { email: LOCAL_PART, domain: DOMAIN, confirm: CONFIRM },
    run: async (api, { email, domain }) => {
      await api('Email', 'delete_pop', { email, domain }, 'POST');
      return { deleted: `${email}@${domain}` };
    },
  },
  {
    name: 'save_file',
    description:
      'Writes a text file (replacing it if it exists). Read it first and show the change.',
    readOnly: false,
    destructive: true,
    input: {
      dir: HOME_PATH,
      file: FILE_NAME,
      content: z.string().max(MAX_FILE_CHARS),
      confirm: CONFIRM,
    },
    run: async (api, { dir, file, content }) => {
      await api('Fileman', 'save_file_content', { dir, file, content }, 'POST');
      return { saved: `${dir.replace(/\/+$/, '')}/${file}`, chars: content.length };
    },
  },
  {
    name: 'start_autossl_check',
    description: 'Asks cPanel to issue or renew free SSL certificates for the account now.',
    readOnly: false,
    destructive: false,
    input: { confirm: CONFIRM },
    run: async (api) => {
      await api('SSL', 'start_autossl_check', {}, 'POST');
      return { started: true };
    },
  },
  {
    name: 'create_backup',
    description: 'Starts a full backup of the account into the home directory.',
    readOnly: false,
    destructive: false,
    input: { confirm: CONFIRM },
    run: async (api) => {
      await api('Backup', 'fullbackup_to_homedir', {}, 'POST');
      return { started: true };
    },
  },
];

/** A tool result as text the model reads, cut to a size the chat can hold. */
export function toToolResult(value) {
  const text = JSON.stringify(value ?? null);
  return {
    content: [
      {
        type: 'text',
        text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…[truncated]` : text,
      },
    ],
  };
}

export const toToolError = (error) => ({
  isError: true,
  content: [
    {
      type: 'text',
      text:
        error instanceof SiteError ? `${error.code}: ${error.message}` : 'cPanel request failed.',
    },
  ],
});

/** Registers the curated tools on `server` for one request's account. */
export function registerCpanelTools(server, credentials, options = {}) {
  const api = (module, fn, params, method) =>
    callUapi(credentials, module, fn, params, { ...options, method });
  for (const tool of CPANEL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.readOnly ? false : Boolean(tool.destructive),
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          return toToolResult(await tool.run(api, args ?? {}));
        } catch (error) {
          return toToolError(error);
        }
      },
    );
  }
}
