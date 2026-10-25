import { createStore, Provider } from 'jotai';
import { renderHook } from '@testing-library/react';
import { Permissions, SystemRoles, PermissionTypes } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TAuthContext } from '~/common';
import { adminAdvancedModeAtom } from '~/store/admin';
import { AuthContext } from '~/hooks/AuthContext';
import useHasAccess from '../useHasAccess';

const roles = {
  [SystemRoles.USER]: {
    name: SystemRoles.USER,
    permissions: { [PermissionTypes.PROMPTS]: { [Permissions.USE]: false } },
  },
  [SystemRoles.ADMIN]: {
    name: SystemRoles.ADMIN,
    permissions: { [PermissionTypes.PROMPTS]: { [Permissions.USE]: true } },
  },
};

function render(role: string, advanced: boolean, withUserRole = true) {
  const store = createStore();
  store.set(adminAdvancedModeAtom, advanced);
  const auth = {
    isAuthenticated: true,
    user: { id: 'u1', role },
    roles: withUserRole ? roles : { [SystemRoles.ADMIN]: roles[SystemRoles.ADMIN] },
  } as unknown as TAuthContext;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </Provider>
  );
  return renderHook(
    () => useHasAccess({ permissionType: PermissionTypes.PROMPTS, permission: Permissions.USE }),
    { wrapper },
  ).result.current;
}

describe('useHasAccess', () => {
  it('reads the USER role for an admin outside advanced mode', () => {
    expect(render(SystemRoles.ADMIN, false)).toBe(false);
  });

  it("reads the admin's own role in advanced mode", () => {
    expect(render(SystemRoles.ADMIN, true)).toBe(true);
  });

  it('falls back to the admin role until the USER role has loaded', () => {
    expect(render(SystemRoles.ADMIN, false, false)).toBe(true);
  });

  it('reads the USER role for users whatever the flag says', () => {
    expect(render(SystemRoles.USER, true)).toBe(false);
  });
});
