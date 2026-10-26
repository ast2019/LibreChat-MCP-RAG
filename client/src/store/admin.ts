import { createStorageAtom } from './jotai-utils';

/**
 * The admin's advanced mode, per browser. Off, an ADMIN's chat reads the USER role's
 * permissions, so it looks exactly like a user's; on, the admin's own permissions (builders,
 * MCP, Skills, prompts, admin settings buttons) appear. Toggled from the admin page.
 */
export const adminAdvancedModeAtom = createStorageAtom<boolean>('adminAdvancedMode', false);
