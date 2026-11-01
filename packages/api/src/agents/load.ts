import { logger } from '@librechat/data-schemas';
import {
  Tools,
  Constants,
  isAgentsEndpoint,
  isEphemeralAgentId,
  getEphemeralSender,
  encodeEphemeralAgentId,
  resolveMCPAppsPolicy,
} from 'librechat-data-provider';
import type {
  AgentModelParameters,
  AgentToolOptions,
  TEphemeralAgent,
  TModelSpec,
  Agent,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { MCPClientCapabilityProfile } from '~/mcp/capabilities';
import type { ParsedServerConfig } from '~/mcp/types';
import {
  requiresEphemeralUserConnection,
  filterChatSelectableMCPServers,
  validateMCPServerConfig,
} from '~/mcp/utils';
import { ASK_USER_QUESTION_TOOL_NAME } from '~/agents/hitl/askUserQuestionTool';
import { resolveMCPClientCapabilityProfile } from '~/mcp/capabilities';
import { synthesizeBackgroundToolOptions } from '~/agents/background';
import { mergeSynthesizedToolOptions } from '~/agents/selection';
import { synthesizeIntentToolOptions } from '~/agents/intent';
import { getCustomEndpointConfig } from '~/app/config';
import { getChatPersianTools } from '~/persian/config';
import { getChatBrowserTools } from '~/browser/config';
import { getChatOfficeTools } from '~/office/config';
import { getChatMediaTools } from '~/media/config';
import { debugTrace } from '~/debug/recorder';

const { mcp_all, mcp_delimiter } = Constants;
type ModelParametersWithPromptPrefix = AgentModelParameters & { promptPrefix?: string | null };

export interface LoadAgentDeps {
  /** Resolves the agent without its `versions` history; `version` carries the count. */
  getAgent: (searchParameter: {
    id: string;
  }) => Promise<(Agent & { version?: number; versions?: { length: number } }) | null>;
  getMCPServerTools: (
    userId: string,
    serverName: string,
    serverConfig?: ParsedServerConfig,
    capabilityProfile?: MCPClientCapabilityProfile,
  ) => Promise<Record<string, unknown> | null>;
  /** The MCP servers this user can reach, with the registry's tier precedence
   *  already applied — the resolution behind the client's catalog. Omitted, the
   *  chat selection is used as sent. */
  getAccessibleMCPServers?: (
    userId: string,
    role?: string,
  ) => Promise<Record<string, ParsedServerConfig>>;
}

export interface LoadAgentParams {
  req: {
    user?: { id?: string; role?: string; mediaAccess?: boolean | null };
    config?: AppConfig;
    body?: {
      promptPrefix?: string;
      ephemeralAgent?: TEphemeralAgent;
    };
  };
  spec?: string;
  agent_id: string;
  endpoint: string;
  model_parameters?: AgentModelParameters & { model?: string };
}

/** Whether a spec keeps its conversations off third-party services (`privacy` set). */
export function isDataContainedSpec(spec?: Pick<TModelSpec, 'privacy'> | null): boolean {
  return spec?.privacy === 'private' || spec?.privacy === 'local';
}

/** The request's own tool picks removed, keeping everything else it carries. */
function containEphemeralAgent(agent: TEphemeralAgent): TEphemeralAgent {
  return {
    ...agent,
    mcp: Array.isArray(agent.mcp) ? [] : agent.mcp,
    web_search: false,
    file_search: false,
    execute_code: false,
    browser: false,
  };
}

/**
 * Load an ephemeral agent based on the request parameters.
 */
export async function loadEphemeralAgent(
  { req, spec, endpoint, model_parameters: _m }: Omit<LoadAgentParams, 'agent_id'>,
  deps: LoadAgentDeps,
): Promise<Agent | null> {
  const { model, ...model_parameters } = _m ?? ({} as unknown as AgentModelParameters);
  const modelSpecs = req.config?.modelSpecs as { list?: TModelSpec[] } | undefined;
  let modelSpec: TModelSpec | null = null;
  if (spec != null && spec !== '') {
    modelSpec = modelSpecs?.list?.find((s) => s.name === spec) ?? null;
  }
  /** A confidential (`private`) or `local` spec promises that the conversation reaches no
   *  third party, so what the request picks for itself — MCP servers, web search, file search,
   *  code — is dropped and only the operator's own spec settings apply. The composer hides
   *  those controls for these specs; this holds even for a request that sends them anyway. */
  const keepsDataInside = isDataContainedSpec(modelSpec);
  const requested: TEphemeralAgent | undefined = req.body?.ephemeralAgent;
  const ephemeralAgent: TEphemeralAgent | undefined =
    keepsDataInside && requested != null ? containEphemeralAgent(requested) : requested;
  if (keepsDataInside && requested != null && req.body != null) {
    req.body.ephemeralAgent = ephemeralAgent;
  }
  const userId = req.user?.id ?? '';
  const capabilityProfile = resolveMCPClientCapabilityProfile(
    resolveMCPAppsPolicy(req.config?.mcpSettings?.apps),
  );
  /** The picker's own selection is narrowed to what the picker may offer; a
   *  spec's servers are the operator's choice and are added after, so pinning a
   *  chat-hidden server to a spec keeps working. */
  const mcpServers = new Set<string>(
    await filterChatSelectableMCPServers(ephemeralAgent?.mcp, {
      userId,
      role: req.user?.role,
      getAccessibleMCPServers: deps.getAccessibleMCPServers,
    }),
  );
  if (modelSpec?.mcpServers) {
    for (const mcpServer of modelSpec.mcpServers) {
      mcpServers.add(mcpServer);
    }
  }
  /** Publish the servers this request will actually use back onto the body. The
   *  instruction path reads `req.body.ephemeralAgent.mcp` directly and prefers
   *  it over the agent's tools, so it would otherwise both inject a hidden
   *  server's `serverInstructions` and omit a spec-pinned server's. */
  if (ephemeralAgent != null && Array.isArray(ephemeralAgent.mcp)) {
    ephemeralAgent.mcp = [...mcpServers];
  }
  const tools: string[] = [];
  if (ephemeralAgent?.execute_code === true || modelSpec?.executeCode === true) {
    tools.push(Tools.execute_code);
  }
  if (ephemeralAgent?.file_search === true || modelSpec?.fileSearch === true) {
    tools.push(Tools.file_search);
  }
  if (ephemeralAgent?.web_search === true || modelSpec?.webSearch === true) {
    tools.push(Tools.web_search);
  }
  if (ephemeralAgent?.memory === true || modelSpec?.memory === true) {
    tools.push(Tools.memory);
  }
  /** The question form, in every chat: the model asks its clarifying questions in a form
   *  instead of a list of text. The agents capability `ask_user_question` turns it off for
   *  the whole server, and `createRun` still equips it only when the request is
   *  HITL-capable, the agent is not a subagent, and the admin hasn't excluded it
   *  (filteredTools/includedTools); the OpenAI-compatible API never gets it. Private and
   *  local specs get no chat tools, like the Persian and Office tools: their models may not
   *  call tools at all. A spec's or the composer's own flag still equips it there. */
  const privateSpec = modelSpec?.privacy === 'private' || modelSpec?.privacy === 'local';
  if (
    !privateSpec ||
    ephemeralAgent?.ask_user_question === true ||
    modelSpec?.askUserQuestion === true
  ) {
    tools.push(ASK_USER_QUESTION_TOOL_NAME);
  }
  /** Image, video and speech generation the model can call in any chat; whether the user may
   *  generate (a pack, or an admin's switch) is checked when a tool runs. */
  tools.push(...getChatMediaTools(req.config, req.user, modelSpec));
  /** Exact dates and Persian spelling fixes, so the model never works them out itself. */
  tools.push(...getChatPersianTools(req.config, modelSpec));
  /** Word and PowerPoint files built from the conversation (the article and slide builders). */
  tools.push(...getChatOfficeTools(req.config, modelSpec));
  /** The agent browser, when the user turned it on for this chat and may use it. */
  if (ephemeralAgent?.browser === true) {
    tools.push(...getChatBrowserTools(req.config, req.user, modelSpec));
  }

  const addedServers = new Set<string>();
  if (mcpServers.size > 0) {
    for (const mcpServer of mcpServers) {
      if (addedServers.has(mcpServer)) {
        continue;
      }
      /** Address durable catalogs by the effective request overlay; request-scoped
       *  overlays still expand fresh through `mcp_all`. */
      const rawOverlayConfig = req.config?.mcpConfig?.[mcpServer];
      const overlayConfig = rawOverlayConfig
        ? validateMCPServerConfig(rawOverlayConfig)
        : undefined;
      const serverTools =
        overlayConfig && requiresEphemeralUserConnection(overlayConfig)
          ? null
          : await deps.getMCPServerTools(userId, mcpServer, overlayConfig, capabilityProfile);
      if (!serverTools) {
        tools.push(`${mcp_all}${mcp_delimiter}${mcpServer}`);
        addedServers.add(mcpServer);
        continue;
      }
      tools.push(...Object.keys(serverTools));
      addedServers.add(mcpServer);
    }
  }

  const requestPromptPrefix = req.body?.promptPrefix;
  const { promptPrefix: modelPromptPrefix, ...safeModelParameters } =
    model_parameters as ModelParametersWithPromptPrefix;
  const instructions =
    typeof modelPromptPrefix === 'string' ? modelPromptPrefix : requestPromptPrefix;

  // Get endpoint config for modelDisplayLabel fallback
  const appConfig = req.config;
  const endpoints = appConfig?.endpoints;
  let endpointConfig = endpoints?.[endpoint as keyof typeof endpoints];
  if (!isAgentsEndpoint(endpoint) && !endpointConfig) {
    try {
      endpointConfig = getCustomEndpointConfig({ endpoint, appConfig });
    } catch (err) {
      logger.error('[loadEphemeralAgent] Error getting custom endpoint config', err);
    }
  }

  const sender = getEphemeralSender({
    modelLabel: (model_parameters as AgentModelParameters & { modelLabel?: string })?.modelLabel,
    specLabel: modelSpec?.label,
    modelDisplayLabel: (endpointConfig as { modelDisplayLabel?: string } | undefined)
      ?.modelDisplayLabel,
  });

  // Encode ephemeral agent ID with endpoint, model, and computed sender for display
  const ephemeralId = encodeEphemeralAgentId({
    endpoint,
    model: model as string,
    sender,
  });

  debugTrace('ephemeral_agent', () => ({
    endpoint,
    model,
    spec: modelSpec?.name ?? null,
    specFound: spec != null && spec !== '' ? modelSpec != null : null,
    privacy: modelSpec?.privacy ?? null,
    keepsDataInside,
    requested,
    applied: ephemeralAgent,
    mcpServers: [...mcpServers],
    tools,
  }));

  const result: Partial<Agent> = {
    id: ephemeralId,
    instructions,
    provider: endpoint,
    model_parameters: safeModelParameters as AgentModelParameters,
    model,
    tools,
  };

  const backgroundToolOptions: AgentToolOptions | undefined = synthesizeBackgroundToolOptions({
    ephemeralAgent,
    modelSpec,
  });
  if (backgroundToolOptions) {
    result.tool_options = backgroundToolOptions;
  }
  const intentToolOptions: AgentToolOptions | undefined = synthesizeIntentToolOptions({
    ephemeralAgent,
    modelSpec,
  });
  if (intentToolOptions) {
    result.tool_options = mergeSynthesizedToolOptions(result.tool_options, intentToolOptions);
  }

  if (ephemeralAgent?.artifacts) {
    result.artifacts = ephemeralAgent.artifacts;
  }
  if (modelSpec?.subagents) {
    result.subagents = modelSpec.subagents;
  }
  if (modelSpec && Object.prototype.hasOwnProperty.call(modelSpec, 'skills')) {
    if (modelSpec.skills === true) {
      result.skills_enabled = true;
    } else if (modelSpec.skills === false) {
      result.skills_enabled = false;
      result.skills = [];
    } else if (Array.isArray(modelSpec.skills)) {
      result.skills_enabled = true;
      result.skills = [];
    }
  }
  return result as Agent;
}

/**
 * Load an agent based on the provided ID.
 * For ephemeral agents, builds a synthetic agent from request parameters.
 * For persistent agents, fetches from the database.
 */
export async function loadAgent(
  params: LoadAgentParams,
  deps: LoadAgentDeps,
): Promise<Agent | null> {
  const { req, spec, agent_id, endpoint, model_parameters } = params;
  if (!agent_id) {
    return null;
  }
  if (isEphemeralAgentId(agent_id)) {
    return loadEphemeralAgent({ req, spec, endpoint, model_parameters }, deps);
  }
  const agent = await deps.getAgent({ id: agent_id });

  if (!agent) {
    return null;
  }

  agent.version ??= agent.versions?.length ?? 0;
  return agent;
}
