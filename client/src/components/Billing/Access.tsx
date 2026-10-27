import { Switch, Skeleton, useToastContext } from '@librechat/client';
import { Permissions, SystemRoles, PermissionTypes } from 'librechat-data-provider';
import type { RolePermissionKey } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useGetRole, useUpdateRolePermissionsMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

type Feature = {
  key: RolePermissionKey;
  type: PermissionTypes;
  label: TranslationKeys;
  description: TranslationKeys;
  /** Offer a second switch for creating/editing, beside using */
  create?: boolean;
  /** The server grants the permission when the role does not store it, so show it on */
  grantedWhenUnset?: boolean;
};

/** What users can do, in the order the chat shows it; each row is one stored permission type. */
const FEATURES: Feature[] = [
  {
    key: 'local-models',
    type: PermissionTypes.LOCAL_MODELS,
    label: 'com_admin_access_local_models',
    description: 'com_admin_access_local_models_desc',
    grantedWhenUnset: true,
  },
  {
    key: 'private-models',
    type: PermissionTypes.PRIVATE_MODELS,
    label: 'com_admin_access_private_models',
    description: 'com_admin_access_private_models_desc',
    grantedWhenUnset: true,
  },
  {
    key: 'web-search',
    type: PermissionTypes.WEB_SEARCH,
    label: 'com_admin_access_web_search',
    description: 'com_admin_access_web_search_desc',
  },
  {
    key: 'file-search',
    type: PermissionTypes.FILE_SEARCH,
    label: 'com_admin_access_file_search',
    description: 'com_admin_access_file_search_desc',
  },
  {
    key: 'file-citations',
    type: PermissionTypes.FILE_CITATIONS,
    label: 'com_admin_access_file_citations',
    description: 'com_admin_access_file_citations_desc',
  },
  {
    key: 'memories',
    type: PermissionTypes.MEMORIES,
    label: 'com_admin_access_memories',
    description: 'com_admin_access_memories_desc',
  },
  {
    key: 'temporary-chat',
    type: PermissionTypes.TEMPORARY_CHAT,
    label: 'com_admin_access_temporary_chat',
    description: 'com_admin_access_temporary_chat_desc',
  },
  {
    key: 'bookmarks',
    type: PermissionTypes.BOOKMARKS,
    label: 'com_admin_access_bookmarks',
    description: 'com_admin_access_bookmarks_desc',
  },
  {
    key: 'prompts',
    type: PermissionTypes.PROMPTS,
    label: 'com_admin_access_prompts',
    description: 'com_admin_access_prompts_desc',
    create: true,
  },
  {
    key: 'agents',
    type: PermissionTypes.AGENTS,
    label: 'com_admin_access_agents',
    description: 'com_admin_access_agents_desc',
    create: true,
  },
  {
    key: 'marketplace',
    type: PermissionTypes.MARKETPLACE,
    label: 'com_admin_access_marketplace',
    description: 'com_admin_access_marketplace_desc',
  },
  {
    key: 'mcp-servers',
    type: PermissionTypes.MCP_SERVERS,
    label: 'com_admin_access_mcp',
    description: 'com_admin_access_mcp_desc',
    create: true,
  },
  {
    key: 'skills',
    type: PermissionTypes.SKILLS,
    label: 'com_admin_access_skills',
    description: 'com_admin_access_skills_desc',
    create: true,
  },
];

function Toggle({
  label,
  feature,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  /** The feature's name, so each switch reads e.g. "Web search: Use" */
  feature: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-text-secondary text-xs" aria-hidden="true">
        {label}
      </span>
      <Switch
        aria-label={`${feature}: ${label}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/** Switches for what the USER role may use; changes apply on the users' next page load. */
export default function Access() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const role = useGetRole(SystemRoles.USER, { refetchOnMount: true });
  const update = useUpdateRolePermissionsMutation();
  const permissions = role.data?.permissions as
    | Partial<Record<PermissionTypes, Partial<Record<Permissions, boolean>>>>
    | undefined;

  const set = (feature: Feature, permission: Permissions, value: boolean) => {
    update.mutate(
      { roleName: SystemRoles.USER, key: feature.key, updates: { [permission]: value } },
      {
        onSuccess: () => showToast({ status: 'success', message: localize('com_admin_saved') }),
        onError: () => showToast({ status: 'error', message: localize('com_admin_save_error') }),
      },
    );
  };

  if (role.isError) {
    return (
      <p role="alert" className="text-text-destructive text-sm">
        {localize('com_admin_load_error')}
      </p>
    );
  }

  return (
    <section aria-labelledby="admin-access" className="space-y-3">
      <div>
        <h2 id="admin-access" className="text-text-primary text-sm font-medium">
          {localize('com_admin_access_title')}
        </h2>
        <p className="text-text-secondary mt-1 text-xs">{localize('com_admin_access_hint')}</p>
      </div>
      <ul className="border-border-light divide-border-light divide-y rounded-xl border">
        {FEATURES.map((feature) => {
          const current = permissions?.[feature.type];
          return (
            <li
              key={feature.key}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              data-testid={`access-${feature.key}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-text-primary text-sm font-medium">
                  {localize(feature.label)}
                </div>
                <div className="text-text-secondary text-xs">{localize(feature.description)}</div>
              </div>
              {role.isLoading ? (
                <Skeleton className="h-5 w-24" />
              ) : (
                <div className="flex items-center gap-4">
                  <Toggle
                    feature={localize(feature.label)}
                    label={localize('com_admin_access_use')}
                    checked={
                      (current?.[Permissions.USE] ?? feature.grantedWhenUnset ?? false) === true
                    }
                    disabled={update.isLoading}
                    onChange={(value) => set(feature, Permissions.USE, value)}
                  />
                  {feature.create === true && (
                    <Toggle
                      feature={localize(feature.label)}
                      label={localize('com_admin_access_create')}
                      checked={current?.[Permissions.CREATE] === true}
                      disabled={update.isLoading || current?.[Permissions.USE] !== true}
                      onChange={(value) => set(feature, Permissions.CREATE, value)}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
