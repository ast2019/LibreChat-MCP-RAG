const {
  handleError,
  applyModelSpecPreset,
  restoreAgentTriggerModelSpec,
  resolveModelSpecForEndpoint,
  resolveModelSpecPromptPrefixVariables,
  inspectContent,
  extractChatContent,
  contentFilterBlockResponse,
  getReasoningCapabilities,
  applyRequestReasoningOverride,
  checkSpecPrivacyLock,
  SPEC_PRIVACY_LOCK_MESSAGES,
} = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  EndpointURLs,
  Constants,
  EModelEndpoint,
  isAgentsEndpoint,
  parseCompactConvo,
  getDefaultParamsEndpoint,
} = require('librechat-data-provider');
const azureAssistants = require('~/server/services/Endpoints/azureAssistants');
const assistants = require('~/server/services/Endpoints/assistants');
const { getEndpointsConfig } = require('~/server/services/Config');
const agents = require('~/server/services/Endpoints/agents');
const { updateFilesUsage, getConvo } = require('~/models');

const buildFunction = {
  [EModelEndpoint.agents]: agents.buildOptions,
  [EModelEndpoint.assistants]: assistants.buildOptions,
  [EModelEndpoint.azureAssistants]: azureAssistants.buildOptions,
};

/**
 * Inspects only the user-authored value substituted for `{{current_user}}`.
 * The surrounding model-spec prompt is administrator-authored, so treating the
 * entire resolved prompt as user provenance would incorrectly apply user
 * content policy to static deployment configuration.
 *
 * `extractChatContent` deliberately gives prompt prefixes both prompt and
 * agent-instruction semantics, preserving the source-specific field controls
 * for the exact value that becomes model-bound.
 *
 * @param {ServerRequest} req
 * @param {unknown} promptPrefixTemplate
 * @returns {import('@librechat/api').ProtectionFinding | null}
 */
function inspectResolvedCurrentUser(req, promptPrefixTemplate) {
  if (
    typeof promptPrefixTemplate !== 'string' ||
    !/{{\s*current_user\s*}}/i.test(promptPrefixTemplate) ||
    !req.user?.name
  ) {
    return null;
  }

  return inspectContent(extractChatContent({ promptPrefix: String(req.user.name) }), {
    filters: req.config?.filters,
  });
}

/** Same registry symbol `@librechat/api` brands lineage-only conversation snapshots with. */
const PARTIAL_RESOLVED_CONVERSATION = Symbol.for('librechat.resolvedConversation.partial');

/**
 * Reads the spec persisted on the conversation this turn continues, reusing the
 * document an earlier middleware (the subagent-thread guard) already loaded for the
 * same id instead of issuing another read. A lineage-only snapshot without a `spec`
 * is not authoritative, so it falls back to the database.
 *
 * @param {ServerRequest} req
 * @param {string} conversationId
 * @returns {Promise<{ exists: boolean; spec: string | null }>}
 */
async function loadStoredConversationSpec(req, conversationId) {
  if (Object.prototype.hasOwnProperty.call(req, 'resolvedConversation')) {
    const resolved = req.resolvedConversation;
    if (resolved == null) {
      return { exists: false, spec: null };
    }
    if (
      resolved.conversationId === conversationId &&
      (resolved[PARTIAL_RESOLVED_CONVERSATION] !== true ||
        Object.prototype.hasOwnProperty.call(resolved, 'spec'))
    ) {
      return { exists: true, spec: resolved.spec ?? null };
    }
  }

  const conversation = await getConvo(req.user.id, conversationId);
  return conversation
    ? { exists: true, spec: conversation.spec ?? null }
    : { exists: false, spec: null };
}

/**
 * Applies the private-spec lock regardless of `enforce` (admins included): it is a
 * data-safety rule, active whenever a spec list is configured.
 *
 * @param {ServerRequest} req
 * @param {string | null | undefined} requestedSpec
 * @returns {Promise<string | null>} refusal text, or `null` when the turn may proceed
 */
async function getSpecPrivacyLockError(req, requestedSpec) {
  const list = req.config?.modelSpecs?.list;
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }

  const rawAdded = req.body?.addedConvo;
  const addedConvo =
    rawAdded != null && typeof rawAdded === 'object' && !Array.isArray(rawAdded)
      ? rawAdded
      : undefined;
  /** `undefined` = no added conversation; `null` = one without a spec. */
  let addedSpec;
  if (addedConvo !== undefined) {
    addedSpec =
      typeof addedConvo.spec === 'string' && addedConvo.spec !== '' ? addedConvo.spec : null;
  }

  const conversationId = req.body?.conversationId;
  const isExisting =
    typeof conversationId === 'string' &&
    conversationId !== '' &&
    conversationId !== Constants.NEW_CONVO &&
    req.user?.id != null;

  /** @type {{ exists: boolean; spec: string | null }} */
  let stored = { exists: false, spec: null };
  if (isExisting) {
    stored = await loadStoredConversationSpec(req, conversationId);
  }

  const result = checkSpecPrivacyLock({
    list,
    storedSpec: stored.spec,
    requestedSpec: requestedSpec ?? null,
    /** A persisted conversation already holds messages. */
    hasMessages: stored.exists,
    addedSpec,
  });
  if (result.allowed) {
    return null;
  }

  logger.warn('[buildEndpointOption] Refused model spec change by privacy lock', {
    reason: result.reason,
    conversationId,
  });
  return SPEC_PRIVACY_LOCK_MESSAGES[result.reason];
}

async function buildEndpointOption(req, res, next) {
  restoreAgentTriggerModelSpec(req);
  const { endpoint, endpointType } = req.body;
  const isAgents =
    isAgentsEndpoint(endpoint) || req.baseUrl.startsWith(EndpointURLs[EModelEndpoint.agents]);

  let endpointsConfig;
  try {
    endpointsConfig = await getEndpointsConfig(req);
  } catch (error) {
    logger.error('Error fetching endpoints config in buildEndpointOption', error);
  }

  const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, endpoint);

  let parsedBody;
  try {
    parsedBody = parseCompactConvo({
      endpoint,
      endpointType,
      conversation: req.body,
      defaultParamsEndpoint,
    });
  } catch (error) {
    logger.error('Error parsing compact conversation', error);
    return handleError(res, { text: 'Error parsing conversation' });
  }

  const appConfig = req.config;
  let appliedModelSpecPrivateFields = new Set();
  let enforcedModelSpecFields = new Set();
  /** Enforced specs that access rules (`adminOnly`, local/private access) filtered down to
   * none leave the principal no model; they must not fall through to an unchecked endpoint. */
  if (
    appConfig.modelSpecs?.enforce &&
    Array.isArray(appConfig.modelSpecs.list) &&
    appConfig.modelSpecs.list.length === 0
  ) {
    return handleError(res, { text: 'No model spec available' });
  }
  if (appConfig.modelSpecs?.list?.length && appConfig.modelSpecs?.enforce) {
    /** @type {{ list: TModelSpec[] }}*/
    const { list } = appConfig.modelSpecs;
    const rawSpec = req.body.spec;
    const spec = parsedBody.spec ?? (typeof rawSpec === 'string' ? rawSpec : undefined);
    const rawChatProjectId = req.body.chatProjectId;
    const parsedBodyForModelSpec =
      parsedBody.chatProjectId === undefined &&
      (typeof rawChatProjectId === 'string' || rawChatProjectId === null)
        ? { ...parsedBody, chatProjectId: rawChatProjectId }
        : parsedBody;

    if (!spec) {
      return handleError(res, { text: 'No model spec selected' });
    }

    const modelSpecResolution = resolveModelSpecForEndpoint({
      modelSpecs: { list },
      spec,
      endpoint,
    });
    if ('error' in modelSpecResolution) {
      return handleError(res, {
        text:
          modelSpecResolution.error === 'invalid-model-spec'
            ? 'Invalid model spec'
            : 'Model spec mismatch',
      });
    }
    const { modelSpec: currentModelSpec } = modelSpecResolution;

    try {
      const result = applyModelSpecPreset({
        modelSpec: currentModelSpec,
        parsedBody: parsedBodyForModelSpec,
        endpoint,
        endpointType,
        defaultParamsEndpoint,
        includePresetDefaults: true,
      });
      parsedBody = result.parsedBody;
      appliedModelSpecPrivateFields = result.appliedPrivateFields;
      enforcedModelSpecFields = result.enforcedFields;
    } catch (error) {
      logger.error('Error parsing model spec', error);
      return handleError(res, { text: 'Error parsing model spec' });
    }
  } else if (parsedBody.spec && appConfig.modelSpecs?.list) {
    const modelSpecResolution = resolveModelSpecForEndpoint({
      modelSpecs: appConfig.modelSpecs,
      spec: parsedBody.spec,
      endpoint,
    });
    if ('modelSpec' in modelSpecResolution) {
      const { modelSpec } = modelSpecResolution;

      try {
        const result = applyModelSpecPreset({
          modelSpec,
          parsedBody,
          endpoint,
          endpointType,
          defaultParamsEndpoint,
        });
        parsedBody = result.parsedBody;
        appliedModelSpecPrivateFields = result.appliedPrivateFields;
      } catch (error) {
        logger.error('Error parsing model spec', error);
        return handleError(res, { text: 'Error parsing model spec' });
      }
    } else if (modelSpecResolution.error === 'model-spec-mismatch') {
      return handleError(res, { text: 'Model spec mismatch' });
    }
  }

  try {
    const rawRequestedSpec = req.body.spec;
    const privacyLockError = await getSpecPrivacyLockError(
      req,
      parsedBody.spec ?? (typeof rawRequestedSpec === 'string' ? rawRequestedSpec : null),
    );
    if (privacyLockError != null) {
      return handleError(res, { text: privacyLockError });
    }
  } catch (error) {
    logger.error('Error checking model spec privacy lock', error);
    return handleError(res, { text: 'Error checking model spec privacy lock' });
  }

  if (!isAgents && appliedModelSpecPrivateFields.has('promptPrefix')) {
    const promptPrefixTemplate = parsedBody.promptPrefix;
    parsedBody = resolveModelSpecPromptPrefixVariables(
      parsedBody,
      req.user,
      req.body.clientTimestamp,
    );
    const finding = inspectResolvedCurrentUser(req, promptPrefixTemplate);
    if (finding != null) {
      return res.status(400).json(contentFilterBlockResponse(finding));
    }
  }

  try {
    const builder = isAgents
      ? (...args) => buildFunction[EModelEndpoint.agents](req, ...args)
      : buildFunction[endpointType ?? endpoint];

    // TODO: use object params
    req.body = req.body || {}; // Express 5: ensure req.body exists
    req.body.endpointOption = await builder(endpoint, parsedBody, endpointType);

    const reasoningApplied = await applyRequestReasoningOverride(req, {
      reasoningOverride: req.body.reasoningOverride,
      endpoint,
      endpointType,
      parsedModel: parsedBody.model,
      isAgent: isAgents,
      endpointsConfig,
      defaultParamsEndpoint,
      appliedModelSpecPrivateFields,
      enforcedModelSpecFields,
      loadReasoningCapabilities: (endpointName) =>
        getReasoningCapabilities(appConfig, endpointName),
    });
    if (!reasoningApplied) {
      return handleError(res, { text: 'Invalid reasoning override' });
    }

    if (req.body.files && !isAgents) {
      req.body.endpointOption.attachments = updateFilesUsage(req.body.files, undefined, {
        user: req.user.id,
        tenantId: req.user.tenantId,
      });
    }

    next();
  } catch (error) {
    logger.error('Error building endpoint option', error);
    return handleError(res, { text: 'Error building endpoint option' });
  }
}

module.exports = buildEndpointOption;
