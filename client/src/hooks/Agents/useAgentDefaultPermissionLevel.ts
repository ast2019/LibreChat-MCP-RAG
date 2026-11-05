import { Permissions, PermissionBits, PermissionTypes } from 'librechat-data-provider';
import { useHasAccess } from '~/hooks/Roles';

/**
 * Permission bit for **Agent Builder** list/select queries only.
 *
 * Marketplace access means the builder should show agents the user can edit.
 * Chat / use surfaces must query `PermissionBits.VIEW` and must not reuse this
 * hook to hide Viewer-shared agents from the model picker.
 */
const useAgentDefaultPermissionLevel = () => {
  const hasMarketplaceAccess = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });

  return hasMarketplaceAccess ? PermissionBits.EDIT : PermissionBits.VIEW;
};

export default useAgentDefaultPermissionLevel;
