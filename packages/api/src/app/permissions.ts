import { logger, getTenantId, tenantStorage, SYSTEM_TENANT_ID } from '@librechat/data-schemas';
import {
  SystemRoles,
  Permissions,
  roleDefaults,
  PermissionTypes,
  getConfigDefaults,
} from 'librechat-data-provider';
import type { IRole, AppConfig } from '@librechat/data-schemas';
import type { RecordAuditEntry } from '~/admin/audit';
import { diffRolePermissions, recordSystemAuditEntry } from '~/admin/audit';
import { getSafeErrorMetadata } from '~/utils/errors';
import { isMemoryEnabled } from '~/memory/config';

type RolePermissions = Partial<Record<PermissionTypes, Record<string, boolean | undefined>>>;
type PermissionField =
  | 'prompts'
  | 'agents'
  | 'skills'
  | 'schedules'
  | 'mcpServers'
  | 'sharedLinks'
  | 'remoteAgents';

/**
 * Checks if a permission type has explicit configuration
 */
function hasExplicitConfig(
  interfaceConfig: AppConfig['interfaceConfig'],
  permissionType: PermissionTypes,
) {
  switch (permissionType) {
    case PermissionTypes.PROMPTS:
      return interfaceConfig?.prompts !== undefined;
    case PermissionTypes.BOOKMARKS:
      return interfaceConfig?.bookmarks !== undefined;
    case PermissionTypes.MEMORIES:
      return interfaceConfig?.memories !== undefined;
    case PermissionTypes.MULTI_CONVO:
      return interfaceConfig?.multiConvo !== undefined;
    case PermissionTypes.AGENTS:
      return interfaceConfig?.agents !== undefined;
    case PermissionTypes.TEMPORARY_CHAT:
      return interfaceConfig?.temporaryChat !== undefined;
    case PermissionTypes.RUN_CODE:
      return interfaceConfig?.runCode !== undefined;
    case PermissionTypes.WEB_SEARCH:
      return interfaceConfig?.webSearch !== undefined;
    case PermissionTypes.PEOPLE_PICKER:
      return interfaceConfig?.peoplePicker !== undefined;
    case PermissionTypes.MARKETPLACE:
      return interfaceConfig?.marketplace !== undefined;
    case PermissionTypes.FILE_SEARCH:
      return interfaceConfig?.fileSearch !== undefined;
    case PermissionTypes.FILE_CITATIONS:
      return interfaceConfig?.fileCitations !== undefined;
    case PermissionTypes.MCP_SERVERS:
      return interfaceConfig?.mcpServers !== undefined;
    case PermissionTypes.REMOTE_AGENTS:
      return interfaceConfig?.remoteAgents !== undefined;
    case PermissionTypes.SKILLS:
      return interfaceConfig?.skills !== undefined;
    case PermissionTypes.SHARED_LINKS:
      return interfaceConfig?.sharedLinks !== undefined;
    case PermissionTypes.SCHEDULES: {
      // `schedules` is dual-purpose. The BOOLEAN form is the RUNTIME kill switch read
      // by getLimits, NOT a permission config: treating it as explicit would write
      // SCHEDULES.USE into the role docs, and removing the kill switch later would
      // leave that disabled permission stuck (forbidden) until manual repair. Only an
      // OBJECT carrying explicit use/create is permission intent; runtime-only limits
      // (maxPerUser, fireConcurrency, …) are not.
      const schedules = interfaceConfig?.schedules;
      if (typeof schedules !== 'object' || schedules == null) {
        return false;
      }
      return schedules.use !== undefined || schedules.create !== undefined;
    }
    default:
      return false;
  }
}

/**
 * `WEB_SEARCH.USE` gates provider-native search (the `web_search` model parameter) as well as
 * LibreChat's `web_search` tool. Warns when model specs ask for native search that a role's
 * effective permission blocks, whether `interface.webSearch: false` sets it or a stored role keeps it.
 */
function warnNativeWebSearchDenied(
  appConfig: AppConfig,
  deniedRoles: string[],
  isExplicitlyConfigured: boolean,
): void {
  if (deniedRoles.length === 0) {
    return;
  }
  const specs = (appConfig.modelSpecs?.list ?? [])
    .filter((spec) => spec.preset?.web_search === true)
    .map((spec) => spec.name);
  if (specs.length === 0) {
    return;
  }
  const source = isExplicitlyConfigured
    ? '`interface.webSearch: false` denies'
    : '`interface.webSearch` is not set, and the stored role permission keeps denying';
  logger.warn(
    `Model specs request provider-native web search (\`preset.web_search: true\`), but ${source} the \`WEB_SEARCH\` permission for roles ${deniedRoles.join(', ')}, which also blocks native search: ${specs.join(', ')}. ` +
      "To offer native search without LibreChat's search tool, set `interface.webSearch: true` and remove `web_search` from `endpoints.agents.capabilities`. " +
      'Removing `interface.webSearch` alone keeps the stored role permission; set it explicitly or update the role in the admin settings. See "Native-only web search" in UPGRADING.md.',
  );
}

export async function updateInterfacePermissions({
  appConfig,
  getRoleByName,
  updateAccessPermissions,
  recordAuditEntry,
  tenantId,
}: {
  appConfig: AppConfig;
  getRoleByName: (roleName: string, fieldsToSelect?: string | string[]) => Promise<IRole | null>;
  updateAccessPermissions: (
    roleName: string,
    permissionsUpdate: Partial<Record<PermissionTypes, Record<string, boolean | undefined>>>,

    roleData?: IRole | null,
  ) => Promise<void>;
  /** Records a `role.synced` entry for each role whose stored permissions changed. */
  recordAuditEntry?: RecordAuditEntry;
  /**
   * Optional tenant ID for scoping role updates to a specific tenant.
   * When provided (and not SYSTEM_TENANT_ID), runs inside `tenantStorage.run({ tenantId })`.
   * When omitted or SYSTEM_TENANT_ID, uses the caller's existing ALS context.
   */
  tenantId?: string;
}): Promise<void> {
  if (tenantId && tenantId !== SYSTEM_TENANT_ID) {
    return tenantStorage.run({ tenantId }, async () =>
      updateInterfacePermissions({
        appConfig,
        getRoleByName,
        updateAccessPermissions,
        recordAuditEntry,
      }),
    );
  }

  const loadedInterface = appConfig?.interfaceConfig;
  if (!loadedInterface) {
    return;
  }
  /** Configured values for interface object structure */
  const interfaceConfig = appConfig?.config?.interface;
  const memoryConfig = appConfig?.config?.memory;
  const memoryEnabled = isMemoryEnabled(memoryConfig);
  /** Check if memory is explicitly disabled (memory.disabled === true) */
  const isMemoryExplicitlyDisabled = memoryConfig?.disabled === true;
  /** Check if memory should be enabled (explicitly enabled or configured) */
  const shouldEnableMemory =
    memoryConfig?.disabled === false ||
    (memoryConfig && memoryEnabled && memoryConfig.disabled === undefined);
  /** Check if personalization is enabled (defaults to true if memory is configured and enabled) */
  const isPersonalizationEnabled =
    memoryConfig && memoryEnabled && memoryConfig.personalize !== false;

  /** Helper to get permission value with proper precedence */
  const getPermissionValue = (
    configValue?: boolean,
    roleDefault?: boolean,
    schemaDefault?: boolean,
  ) => {
    if (configValue !== undefined) return configValue;
    if (roleDefault !== undefined) return roleDefault;
    return schemaDefault;
  };

  const defaults = getConfigDefaults().interface;
  const webSearchDeniedRoles: string[] = [];
  /** `interface.adminFullAccess` makes the yaml interface restrictions bind USER only. */
  const adminFullAccess = interfaceConfig?.adminFullAccess === true;
  const unrestrictedInterface: NonNullable<AppConfig['interfaceConfig']> = {};

  /**
   * Re-reads the role so the entry lists what was persisted rather than what was
   * requested (`updateAccessPermissions` logs and swallows its own failures).
   */
  const recordRoleSync = async (roleName: string, before: RolePermissions | undefined) => {
    let after: IRole | null;
    let changes: string[];
    try {
      after = await getRoleByName(roleName);
      changes = diffRolePermissions(before, after?.permissions as RolePermissions | undefined);
    } catch (err) {
      /** The verification read is part of auditing, which must not fail startup. */
      logger.error(
        `[updateInterfacePermissions] could not verify '${roleName}' for audit`,
        getSafeErrorMetadata(err),
      );
      return;
    }
    if (!after || changes.length === 0) {
      return;
    }
    const tenantId = getTenantId();
    await recordSystemAuditEntry(
      recordAuditEntry,
      {
        action: 'role.synced',
        severity: 'warning',
        actor: { type: 'system', name: 'librechat.yaml interface sync' },
        target: { type: 'role', id: roleName, name: roleName },
        metadata: { changes: changes.join(', '), changeCount: changes.length },
        tenantId: tenantId && tenantId !== SYSTEM_TENANT_ID ? tenantId : undefined,
      },
      '[updateInterfacePermissions]',
    );
  };

  // Permission precedence order:
  // 1. Explicit user configuration (from librechat.yaml)
  // 2. Role-specific defaults (from roleDefaults)
  // 3. Interface schema defaults (from interfaceSchema.default())
  // With `adminFullAccess`, ADMIN skips step 1 and every permission type is rewritten on
  // startup, so a role doc stored while the yaml restricted ADMIN is restored to its defaults.
  for (const roleName of [SystemRoles.USER, SystemRoles.ADMIN]) {
    const defaultPerms = roleDefaults[roleName]?.permissions;
    const unrestricted = adminFullAccess && roleName === SystemRoles.ADMIN;
    /** Loaded interface values this role honors; empty when unrestricted. */
    const roleInterface = unrestricted ? unrestrictedInterface : loadedInterface;
    /** Raw yaml interface this role honors; absent when unrestricted. */
    const yamlInterface = unrestricted ? undefined : interfaceConfig;
    /** Whether the yaml sets any of `keys` on an object-form field (always, when unrestricted). */
    const configures = (field: PermissionField, ...keys: string[]) => {
      if (unrestricted) {
        return true;
      }
      const value = yamlInterface?.[field];
      return typeof value === 'object' && value != null && keys.some((key) => key in value);
    };

    const existingRole = await getRoleByName(roleName);
    const existingPermissions = existingRole?.permissions as
      | Partial<Record<PermissionTypes, Record<string, boolean | undefined>>>
      | undefined;
    const permissionsToUpdate: Partial<
      Record<PermissionTypes, Record<string, boolean | undefined>>
    > = {};

    /**
     * Helper to add permission if it should be updated
     */
    const addPermissionIfNeeded = (
      permType: PermissionTypes,
      permissions: Record<string, boolean | undefined>,
    ) => {
      const permTypeExists = existingPermissions?.[permType];
      const isExplicitlyConfigured =
        unrestricted || (yamlInterface && hasExplicitConfig(yamlInterface, permType));
      const isMemoryDisabled = permType === PermissionTypes.MEMORIES && isMemoryExplicitlyDisabled;
      const isMemoryReenabling =
        permType === PermissionTypes.MEMORIES &&
        shouldEnableMemory &&
        existingPermissions?.[PermissionTypes.MEMORIES]?.[Permissions.USE] === false;

      // Only update if: doesn't exist OR explicitly configured OR memory state change
      if (!permTypeExists || isExplicitlyConfigured || isMemoryDisabled || isMemoryReenabling) {
        permissionsToUpdate[permType] = permissions;
        if (!permTypeExists) {
          logger.debug(`Role '${roleName}': Setting up default permissions for '${permType}'`);
        } else if (isExplicitlyConfigured) {
          logger.debug(`Role '${roleName}': Applying explicit config for '${permType}'`);
        } else if (isMemoryDisabled) {
          logger.debug(`Role '${roleName}': Disabling memories as memory.disabled is true`);
        } else if (isMemoryReenabling) {
          logger.debug(`Role '${roleName}': Re-enabling memories due to memory configuration`);
        }
      } else {
        logger.debug(`Role '${roleName}': Preserving existing permissions for '${permType}'`);
      }
    };

    // Helper to extract value from boolean or object config
    type PermissionConfig =
      | boolean
      | { use?: boolean; create?: boolean; share?: boolean; public?: boolean }
      | undefined;
    const getConfigUse = (config: PermissionConfig) =>
      typeof config === 'boolean' ? config : config?.use;
    const getConfigCreate = (config: PermissionConfig) =>
      typeof config === 'boolean' ? undefined : config?.create;
    const getConfigShare = (config: PermissionConfig) =>
      typeof config === 'boolean' ? undefined : config?.share;
    const getConfigPublic = (config: PermissionConfig) =>
      typeof config === 'boolean' ? undefined : config?.public;

    // Get default values (for backward compat when config is boolean)
    const promptsDefaultUse =
      typeof defaults.prompts === 'boolean' ? defaults.prompts : defaults.prompts?.use;
    const agentsDefaultUse =
      typeof defaults.agents === 'boolean' ? defaults.agents : defaults.agents?.use;
    const skillsDefaultUse =
      typeof defaults.skills === 'boolean' ? defaults.skills : defaults.skills?.use;
    const promptsDefaultCreate =
      typeof defaults.prompts === 'object' ? defaults.prompts?.create : undefined;
    const agentsDefaultCreate =
      typeof defaults.agents === 'object' ? defaults.agents?.create : undefined;
    const skillsDefaultCreate =
      typeof defaults.skills === 'object' ? defaults.skills?.create : undefined;
    const promptsDefaultShare =
      typeof defaults.prompts === 'object' ? defaults.prompts?.share : undefined;
    const agentsDefaultShare =
      typeof defaults.agents === 'object' ? defaults.agents?.share : undefined;
    const skillsDefaultShare =
      typeof defaults.skills === 'object' ? defaults.skills?.share : undefined;
    const promptsDefaultPublic =
      typeof defaults.prompts === 'object' ? defaults.prompts?.public : undefined;
    const agentsDefaultPublic =
      typeof defaults.agents === 'object' ? defaults.agents?.public : undefined;
    const skillsDefaultPublic =
      typeof defaults.skills === 'object' ? defaults.skills?.public : undefined;
    // `schedules` is intentionally absent from the interface DEFAULTS (it is
    // experimental/default-off at runtime), so the PERMISSION defaults are stated here.
    // Runtime availability and the role permission are separate concerns: a user may hold
    // the permission while the feature stays off until an admin enables it.
    const schedulesDefaultUse = true;
    const schedulesDefaultCreate = true;
    const sharedLinksDefaultCreate =
      typeof defaults.sharedLinks === 'boolean' ? undefined : defaults.sharedLinks?.create;
    const sharedLinksDefaultShare =
      typeof defaults.sharedLinks === 'object' ? defaults.sharedLinks?.share : undefined;
    const sharedLinksDefaultPublic =
      typeof defaults.sharedLinks === 'object' ? defaults.sharedLinks?.public : undefined;

    const allPermissions: Partial<Record<PermissionTypes, Record<string, boolean | undefined>>> = {
      [PermissionTypes.PROMPTS]: {
        [Permissions.USE]: getPermissionValue(
          getConfigUse(roleInterface.prompts),
          defaultPerms[PermissionTypes.PROMPTS]?.[Permissions.USE],
          promptsDefaultUse,
        ),
        ...(configures('prompts', 'create') || !existingPermissions?.[PermissionTypes.PROMPTS]
          ? {
              [Permissions.CREATE]: getPermissionValue(
                getConfigCreate(roleInterface.prompts),
                defaultPerms[PermissionTypes.PROMPTS]?.[Permissions.CREATE],
                promptsDefaultCreate ?? true,
              ),
            }
          : {}),
        ...(configures('prompts', 'share', 'public') ||
        !existingPermissions?.[PermissionTypes.PROMPTS]
          ? {
              [Permissions.SHARE]: getPermissionValue(
                getConfigShare(roleInterface.prompts),
                defaultPerms[PermissionTypes.PROMPTS]?.[Permissions.SHARE],
                promptsDefaultShare,
              ),
              [Permissions.SHARE_PUBLIC]: getPermissionValue(
                getConfigPublic(roleInterface.prompts),
                defaultPerms[PermissionTypes.PROMPTS]?.[Permissions.SHARE_PUBLIC],
                promptsDefaultPublic,
              ),
            }
          : {}),
      },
      [PermissionTypes.BOOKMARKS]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.bookmarks,
          defaultPerms[PermissionTypes.BOOKMARKS]?.[Permissions.USE],
          defaults.bookmarks,
        ),
      },
      [PermissionTypes.MEMORIES]: {
        [Permissions.USE]: (() => {
          if (isMemoryExplicitlyDisabled) return false;
          if (shouldEnableMemory) return true;
          return getPermissionValue(
            roleInterface.memories,
            defaultPerms[PermissionTypes.MEMORIES]?.[Permissions.USE],
            defaults.memories,
          );
        })(),
        ...(defaultPerms[PermissionTypes.MEMORIES]?.[Permissions.CREATE] !== undefined && {
          [Permissions.CREATE]: isMemoryExplicitlyDisabled
            ? false
            : defaultPerms[PermissionTypes.MEMORIES][Permissions.CREATE],
        }),
        ...(defaultPerms[PermissionTypes.MEMORIES]?.[Permissions.READ] !== undefined && {
          [Permissions.READ]: isMemoryExplicitlyDisabled
            ? false
            : defaultPerms[PermissionTypes.MEMORIES][Permissions.READ],
        }),
        ...(defaultPerms[PermissionTypes.MEMORIES]?.[Permissions.UPDATE] !== undefined && {
          [Permissions.UPDATE]: isMemoryExplicitlyDisabled
            ? false
            : defaultPerms[PermissionTypes.MEMORIES][Permissions.UPDATE],
        }),
        [Permissions.OPT_OUT]: isMemoryExplicitlyDisabled
          ? false
          : isPersonalizationEnabled || undefined,
      },
      [PermissionTypes.MULTI_CONVO]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.multiConvo,
          defaultPerms[PermissionTypes.MULTI_CONVO]?.[Permissions.USE],
          defaults.multiConvo,
        ),
      },
      [PermissionTypes.AGENTS]: {
        [Permissions.USE]: getPermissionValue(
          getConfigUse(roleInterface.agents),
          defaultPerms[PermissionTypes.AGENTS]?.[Permissions.USE],
          agentsDefaultUse,
        ),
        ...(configures('agents', 'create') || !existingPermissions?.[PermissionTypes.AGENTS]
          ? {
              [Permissions.CREATE]: getPermissionValue(
                getConfigCreate(roleInterface.agents),
                defaultPerms[PermissionTypes.AGENTS]?.[Permissions.CREATE],
                agentsDefaultCreate ?? true,
              ),
            }
          : {}),
        ...(configures('agents', 'share', 'public') ||
        !existingPermissions?.[PermissionTypes.AGENTS]
          ? {
              [Permissions.SHARE]: getPermissionValue(
                getConfigShare(roleInterface.agents),
                defaultPerms[PermissionTypes.AGENTS]?.[Permissions.SHARE],
                agentsDefaultShare,
              ),
              [Permissions.SHARE_PUBLIC]: getPermissionValue(
                getConfigPublic(roleInterface.agents),
                defaultPerms[PermissionTypes.AGENTS]?.[Permissions.SHARE_PUBLIC],
                agentsDefaultPublic,
              ),
            }
          : {}),
      },
      [PermissionTypes.TEMPORARY_CHAT]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.temporaryChat,
          defaultPerms[PermissionTypes.TEMPORARY_CHAT]?.[Permissions.USE],
          defaults.temporaryChat,
        ),
      },
      [PermissionTypes.RUN_CODE]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.runCode,
          defaultPerms[PermissionTypes.RUN_CODE]?.[Permissions.USE],
          defaults.runCode,
        ),
      },
      [PermissionTypes.WEB_SEARCH]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.webSearch,
          defaultPerms[PermissionTypes.WEB_SEARCH]?.[Permissions.USE],
          defaults.webSearch,
        ),
      },
      [PermissionTypes.PEOPLE_PICKER]: {
        [Permissions.VIEW_USERS]: getPermissionValue(
          roleInterface.peoplePicker?.users,
          defaultPerms[PermissionTypes.PEOPLE_PICKER]?.[Permissions.VIEW_USERS],
          defaults.peoplePicker?.users,
        ),
        [Permissions.VIEW_GROUPS]: getPermissionValue(
          roleInterface.peoplePicker?.groups,
          defaultPerms[PermissionTypes.PEOPLE_PICKER]?.[Permissions.VIEW_GROUPS],
          defaults.peoplePicker?.groups,
        ),
        [Permissions.VIEW_ROLES]: getPermissionValue(
          roleInterface.peoplePicker?.roles,
          defaultPerms[PermissionTypes.PEOPLE_PICKER]?.[Permissions.VIEW_ROLES],
          defaults.peoplePicker?.roles,
        ),
      },
      [PermissionTypes.MARKETPLACE]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.marketplace?.use,
          defaultPerms[PermissionTypes.MARKETPLACE]?.[Permissions.USE],
          defaults.marketplace?.use,
        ),
      },
      [PermissionTypes.FILE_SEARCH]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.fileSearch,
          defaultPerms[PermissionTypes.FILE_SEARCH]?.[Permissions.USE],
          defaults.fileSearch,
        ),
      },
      [PermissionTypes.FILE_CITATIONS]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.fileCitations,
          defaultPerms[PermissionTypes.FILE_CITATIONS]?.[Permissions.USE],
          defaults.fileCitations,
        ),
      },
      [PermissionTypes.MCP_SERVERS]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.mcpServers?.use,
          defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.USE],
          defaults.mcpServers?.use,
        ),
        ...(configures('mcpServers', 'create') ||
        !existingPermissions?.[PermissionTypes.MCP_SERVERS]
          ? {
              [Permissions.CREATE]: getPermissionValue(
                typeof yamlInterface?.mcpServers === 'object'
                  ? yamlInterface.mcpServers.create
                  : undefined,
                defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.CREATE],
                defaults.mcpServers?.create,
              ),
            }
          : {}),
        ...(configures('mcpServers', 'share', 'public') ||
        !existingPermissions?.[PermissionTypes.MCP_SERVERS]
          ? {
              [Permissions.SHARE]: getPermissionValue(
                roleInterface.mcpServers?.share,
                defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.SHARE],
                defaults.mcpServers?.share,
              ),
              [Permissions.SHARE_PUBLIC]: getPermissionValue(
                roleInterface.mcpServers?.public,
                defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.SHARE_PUBLIC],
                defaults.mcpServers?.public,
              ),
            }
          : {}),
        ...(configures('mcpServers', 'configureObo') ||
        !existingPermissions?.[PermissionTypes.MCP_SERVERS]
          ? {
              [Permissions.CONFIGURE_OBO]: getPermissionValue(
                roleInterface.mcpServers?.configureObo,
                defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.CONFIGURE_OBO],
                undefined,
              ),
            }
          : {}),
      },
      [PermissionTypes.REMOTE_AGENTS]: {
        [Permissions.USE]: getPermissionValue(
          roleInterface.remoteAgents?.use,
          defaultPerms[PermissionTypes.REMOTE_AGENTS]?.[Permissions.USE],
          defaults.remoteAgents?.use,
        ),
        ...(configures('remoteAgents', 'create') ||
        !existingPermissions?.[PermissionTypes.REMOTE_AGENTS]
          ? {
              [Permissions.CREATE]: getPermissionValue(
                typeof yamlInterface?.remoteAgents === 'object'
                  ? yamlInterface.remoteAgents.create
                  : undefined,
                defaultPerms[PermissionTypes.REMOTE_AGENTS]?.[Permissions.CREATE],
                defaults.remoteAgents?.create,
              ),
            }
          : {}),
        ...(configures('remoteAgents', 'share', 'public') ||
        !existingPermissions?.[PermissionTypes.REMOTE_AGENTS]
          ? {
              [Permissions.SHARE]: getPermissionValue(
                roleInterface.remoteAgents?.share,
                defaultPerms[PermissionTypes.REMOTE_AGENTS]?.[Permissions.SHARE],
                defaults.remoteAgents?.share,
              ),
              [Permissions.SHARE_PUBLIC]: getPermissionValue(
                roleInterface.remoteAgents?.public,
                defaultPerms[PermissionTypes.REMOTE_AGENTS]?.[Permissions.SHARE_PUBLIC],
                defaults.remoteAgents?.public,
              ),
            }
          : {}),
      },
      [PermissionTypes.SKILLS]: {
        [Permissions.USE]: getPermissionValue(
          getConfigUse(roleInterface.skills),
          defaultPerms[PermissionTypes.SKILLS]?.[Permissions.USE],
          skillsDefaultUse,
        ),
        ...(configures('skills', 'create') || !existingPermissions?.[PermissionTypes.SKILLS]
          ? {
              [Permissions.CREATE]: getPermissionValue(
                getConfigCreate(roleInterface.skills),
                defaultPerms[PermissionTypes.SKILLS]?.[Permissions.CREATE],
                skillsDefaultCreate ?? true,
              ),
            }
          : {}),
        ...(configures('skills', 'share', 'public') ||
        !existingPermissions?.[PermissionTypes.SKILLS]
          ? {
              [Permissions.SHARE]: getPermissionValue(
                getConfigShare(roleInterface.skills),
                defaultPerms[PermissionTypes.SKILLS]?.[Permissions.SHARE],
                skillsDefaultShare,
              ),
              [Permissions.SHARE_PUBLIC]: getPermissionValue(
                getConfigPublic(roleInterface.skills),
                defaultPerms[PermissionTypes.SKILLS]?.[Permissions.SHARE_PUBLIC],
                skillsDefaultPublic,
              ),
            }
          : {}),
      },
      [PermissionTypes.SHARED_LINKS]: {
        ...(typeof yamlInterface?.sharedLinks === 'boolean' ||
        configures('sharedLinks', 'create') ||
        !existingPermissions?.[PermissionTypes.SHARED_LINKS]
          ? {
              [Permissions.CREATE]: getPermissionValue(
                typeof roleInterface.sharedLinks === 'boolean'
                  ? roleInterface.sharedLinks
                  : getConfigCreate(roleInterface.sharedLinks),
                defaultPerms[PermissionTypes.SHARED_LINKS]?.[Permissions.CREATE],
                sharedLinksDefaultCreate ?? true,
              ),
            }
          : {}),
        ...(typeof yamlInterface?.sharedLinks === 'boolean' ||
        configures('sharedLinks', 'share', 'public') ||
        !existingPermissions?.[PermissionTypes.SHARED_LINKS]
          ? {
              [Permissions.SHARE]: getPermissionValue(
                typeof roleInterface.sharedLinks === 'boolean'
                  ? roleInterface.sharedLinks
                  : getConfigShare(roleInterface.sharedLinks),
                defaultPerms[PermissionTypes.SHARED_LINKS]?.[Permissions.SHARE],
                sharedLinksDefaultShare,
              ),
              [Permissions.SHARE_PUBLIC]: getPermissionValue(
                typeof roleInterface.sharedLinks === 'boolean'
                  ? roleInterface.sharedLinks
                  : getConfigPublic(roleInterface.sharedLinks),
                defaultPerms[PermissionTypes.SHARED_LINKS]?.[Permissions.SHARE_PUBLIC],
                sharedLinksDefaultPublic,
              ),
            }
          : {}),
      },
      [PermissionTypes.SCHEDULES]: {
        [Permissions.USE]: getPermissionValue(
          // Only an OBJECT `use` drives the permission; the boolean form is the runtime
          // kill switch and must not seed SCHEDULES.USE (see hasExplicitConfig), so a
          // removed kill switch can never leave USE stuck false.
          typeof roleInterface.schedules === 'object' ? roleInterface.schedules?.use : undefined,
          defaultPerms[PermissionTypes.SCHEDULES]?.[Permissions.USE],
          schedulesDefaultUse,
        ),
        ...(configures('schedules', 'create') || !existingPermissions?.[PermissionTypes.SCHEDULES]
          ? {
              [Permissions.CREATE]: getPermissionValue(
                getConfigCreate(roleInterface.schedules),
                defaultPerms[PermissionTypes.SCHEDULES]?.[Permissions.CREATE],
                schedulesDefaultCreate ?? true,
              ),
            }
          : {}),
      },
    };

    // Check and add each permission type if needed
    for (const [permType, permissions] of Object.entries(allPermissions)) {
      addPermissionIfNeeded(permType as PermissionTypes, permissions);
    }

    /**
     * Backfill SHARE / SHARE_PUBLIC for permission types that already exist in the DB but are
     * missing these fields — caused by the PR #11283 schema change that added SHARE/SHARE_PUBLIC
     * to PROMPTS and AGENTS (replacing the removed SHARED_GLOBAL field) without a DB migration.
     *
     * This is intentionally kept separate from `addPermissionIfNeeded` to avoid overwriting
     * user-customised share settings when the config uses a boolean (e.g. `agents: true`).
     * Only fields that are literally absent from the existing DB document are backfilled here;
     * any field that is already set keeps its current value.
     */
    type ShareBackfillEntry = [PermissionTypes, Record<string, boolean | undefined>];
    const shareBackfill: ShareBackfillEntry[] = [
      [
        PermissionTypes.PROMPTS,
        {
          [Permissions.SHARE]: getPermissionValue(
            getConfigShare(roleInterface.prompts),
            defaultPerms[PermissionTypes.PROMPTS]?.[Permissions.SHARE],
            promptsDefaultShare,
          ),
          [Permissions.SHARE_PUBLIC]: getPermissionValue(
            getConfigPublic(roleInterface.prompts),
            defaultPerms[PermissionTypes.PROMPTS]?.[Permissions.SHARE_PUBLIC],
            promptsDefaultPublic,
          ),
        },
      ],
      [
        PermissionTypes.AGENTS,
        {
          [Permissions.SHARE]: getPermissionValue(
            getConfigShare(roleInterface.agents),
            defaultPerms[PermissionTypes.AGENTS]?.[Permissions.SHARE],
            agentsDefaultShare,
          ),
          [Permissions.SHARE_PUBLIC]: getPermissionValue(
            getConfigPublic(roleInterface.agents),
            defaultPerms[PermissionTypes.AGENTS]?.[Permissions.SHARE_PUBLIC],
            agentsDefaultPublic,
          ),
        },
      ],
      [
        PermissionTypes.MCP_SERVERS,
        {
          [Permissions.SHARE]: getPermissionValue(
            roleInterface.mcpServers?.share,
            defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.SHARE],
            defaults.mcpServers?.share,
          ),
          [Permissions.SHARE_PUBLIC]: getPermissionValue(
            roleInterface.mcpServers?.public,
            defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.SHARE_PUBLIC],
            defaults.mcpServers?.public,
          ),
        },
      ],
      [
        PermissionTypes.REMOTE_AGENTS,
        {
          [Permissions.SHARE]: getPermissionValue(
            roleInterface.remoteAgents?.share,
            defaultPerms[PermissionTypes.REMOTE_AGENTS]?.[Permissions.SHARE],
            defaults.remoteAgents?.share,
          ),
          [Permissions.SHARE_PUBLIC]: getPermissionValue(
            roleInterface.remoteAgents?.public,
            defaultPerms[PermissionTypes.REMOTE_AGENTS]?.[Permissions.SHARE_PUBLIC],
            defaults.remoteAgents?.public,
          ),
        },
      ],
      [
        PermissionTypes.SKILLS,
        {
          [Permissions.SHARE]: getPermissionValue(
            getConfigShare(roleInterface.skills),
            defaultPerms[PermissionTypes.SKILLS]?.[Permissions.SHARE],
            skillsDefaultShare,
          ),
          [Permissions.SHARE_PUBLIC]: getPermissionValue(
            getConfigPublic(roleInterface.skills),
            defaultPerms[PermissionTypes.SKILLS]?.[Permissions.SHARE_PUBLIC],
            skillsDefaultPublic,
          ),
        },
      ],
      [
        PermissionTypes.SHARED_LINKS,
        {
          [Permissions.SHARE]: getPermissionValue(
            getConfigShare(roleInterface.sharedLinks),
            defaultPerms[PermissionTypes.SHARED_LINKS]?.[Permissions.SHARE],
            sharedLinksDefaultShare,
          ),
          [Permissions.SHARE_PUBLIC]: getPermissionValue(
            getConfigPublic(roleInterface.sharedLinks),
            defaultPerms[PermissionTypes.SHARED_LINKS]?.[Permissions.SHARE_PUBLIC],
            sharedLinksDefaultPublic,
          ),
        },
      ],
    ];

    for (const [permType, shareDefaults] of shareBackfill) {
      const existingPerms = existingPermissions?.[permType];
      // Skip permission types that don't exist yet — addPermissionIfNeeded already handles those
      if (!existingPerms) {
        continue;
      }

      const missingFields: Record<string, boolean | undefined> = {};
      for (const [field, value] of Object.entries(shareDefaults)) {
        if (
          value !== undefined &&
          existingPerms[field] === undefined &&
          // Don't clobber a value already queued by addPermissionIfNeeded (e.g. explicit config)
          permissionsToUpdate[permType as PermissionTypes]?.[field] === undefined
        ) {
          missingFields[field] = value;
        }
      }

      if (Object.keys(missingFields).length > 0) {
        logger.debug(
          `Role '${roleName}': Backfilling missing share fields for '${permType}': ${Object.keys(missingFields).join(', ')}`,
        );
        // Merge into any update already queued by addPermissionIfNeeded, or create a new entry
        permissionsToUpdate[permType] = { ...permissionsToUpdate[permType], ...missingFields };
      }
    }

    /**
     * One-time migration: correct MCP_SERVERS.CREATE for USER role.
     * Before the explicit roleDefaults fix, Zod schema defaults resolved CREATE to true
     * for all roles. ADMIN should keep CREATE: true, but USER should have CREATE: false
     * unless explicitly configured otherwise in librechat.yaml.
     */
    if (roleName === SystemRoles.USER) {
      const existingMcpPerms = existingPermissions?.[PermissionTypes.MCP_SERVERS];
      const mcpCreateExplicit =
        typeof yamlInterface?.mcpServers === 'object' && 'create' in yamlInterface.mcpServers;
      if (
        existingMcpPerms?.[Permissions.CREATE] === true &&
        !mcpCreateExplicit &&
        defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.CREATE] === false
      ) {
        logger.debug(
          `Role '${roleName}': Migrating MCP_SERVERS.CREATE from true to false (Zod default correction)`,
        );
        permissionsToUpdate[PermissionTypes.MCP_SERVERS] = {
          ...permissionsToUpdate[PermissionTypes.MCP_SERVERS],
          [Permissions.CREATE]: false,
        };
      }
    }

    /**
     * Backfill MCP_SERVERS.CONFIGURE_OBO for existing roles that pre-date the permission.
     * The MCP_SERVERS permission type already exists on these role docs, so the
     * `addPermissionIfNeeded` block above does not re-seed it. Only fill in the field
     * when it is literally absent — never overwrite an admin-set value.
     */
    {
      const existingMcpPerms = existingPermissions?.[PermissionTypes.MCP_SERVERS];
      const oboExplicit =
        typeof yamlInterface?.mcpServers === 'object' && 'configureObo' in yamlInterface.mcpServers;
      const alreadyQueued =
        permissionsToUpdate[PermissionTypes.MCP_SERVERS]?.[Permissions.CONFIGURE_OBO] !== undefined;
      if (
        existingMcpPerms &&
        existingMcpPerms[Permissions.CONFIGURE_OBO] === undefined &&
        !oboExplicit &&
        !alreadyQueued
      ) {
        const backfillValue =
          defaultPerms[PermissionTypes.MCP_SERVERS]?.[Permissions.CONFIGURE_OBO];
        if (backfillValue !== undefined) {
          logger.debug(
            `Role '${roleName}': Backfilling MCP_SERVERS.CONFIGURE_OBO=${backfillValue}`,
          );
          permissionsToUpdate[PermissionTypes.MCP_SERVERS] = {
            ...permissionsToUpdate[PermissionTypes.MCP_SERVERS],
            [Permissions.CONFIGURE_OBO]: backfillValue,
          };
        }
      }
    }

    const webSearchUse =
      permissionsToUpdate[PermissionTypes.WEB_SEARCH]?.[Permissions.USE] ??
      existingPermissions?.[PermissionTypes.WEB_SEARCH]?.[Permissions.USE];
    if (webSearchUse === false) {
      webSearchDeniedRoles.push(roleName);
    }

    // Update permissions if any need updating
    if (Object.keys(permissionsToUpdate).length > 0) {
      await updateAccessPermissions(roleName, permissionsToUpdate, existingRole);
      if (recordAuditEntry) {
        await recordRoleSync(roleName, existingPermissions);
      }
    }
  }

  warnNativeWebSearchDenied(
    appConfig,
    webSearchDeniedRoles,
    hasExplicitConfig(interfaceConfig, PermissionTypes.WEB_SEARCH),
  );
}
