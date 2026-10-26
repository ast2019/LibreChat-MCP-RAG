import { useMemo, useCallback, useContext } from 'react';
import { useAtomValue } from 'jotai';
import { SystemRoles } from 'librechat-data-provider';
import type { TUser, PermissionTypes, Permissions } from 'librechat-data-provider';
import { adminAdvancedModeAtom } from '~/store/admin';
import { AuthContext } from '~/hooks/AuthContext';

const useHasAccess = ({
  permissionType,
  permission,
}: {
  permissionType: PermissionTypes;
  permission: Permissions;
}) => {
  const authContext = useContext(AuthContext);
  const advancedMode = useAtomValue(adminAdvancedModeAtom);
  const user = authContext?.user;
  const roles = authContext?.roles;
  const isAuthenticated = authContext?.isAuthenticated || false;

  const checkAccess = useCallback(
    ({
      user,
      permissionType,
      permission,
    }: {
      user?: TUser | null;
      permissionType: PermissionTypes;
      permission: Permissions;
    }) => {
      if (!authContext) {
        return false;
      }
      if (!isAuthenticated || user?.role == null || !roles) {
        return false;
      }
      /** Outside advanced mode an admin sees the app as a user does (the USER role is loaded
       *  for every signed-in user, admins included) */
      const roleName =
        user.role === SystemRoles.ADMIN && !advancedMode && roles[SystemRoles.USER] != null
          ? SystemRoles.USER
          : user.role;
      const role = roles[roleName];
      if (!role) {
        return false;
      }
      return role.permissions?.[permissionType]?.[permission] === true;
    },
    [authContext, isAuthenticated, roles, advancedMode],
  );

  const hasAccess = useMemo(
    () => checkAccess({ user, permissionType, permission }),
    [user, permissionType, permission, checkAccess],
  );

  return hasAccess;
};

export default useHasAccess;
