const express = require('express');
const mongoose = require('mongoose');
const {
  GenerationJobManager,
  openCheckpointDeletion,
  deleteAllSharedLinksWithCleanup,
  createErasureResolver,
  createAdminUsersHandlers,
  createAdminModelAccessHandlers,
  createAdminApiAccessHandlers,
  createAdminMediaAccessHandlers,
  createAdminBrowserAccessHandlers,
  createAdminAttachVmAccessHandlers,
  createAdminHiggsfieldAccessHandlers,
  createAdminSetPasswordHandler,
  createAdminBulkAccessHandler,
  hashSecret,
  revokeUserCodeEnvironmentWorkers,
} = require('@librechat/api');
const { SystemCapabilities, runAsSystem, tenantStorage } = require('@librechat/data-schemas');
const { requireCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const {
  drainAgentTriggerDeliveriesForUser,
  prepareAgentTriggerUserPurge,
  cancelAgentTriggerUserPurge,
  purgeAgentTriggerDeliveriesForUser,
} = require('~/server/services/Agents/triggers');
const { processDeleteRequest } = require('~/server/services/Files/process');
const { invalidateCachedTools } = require('~/server/services/Config/getCachedTools');
const { getMCPManager, getMCPServersRegistry } = require('~/config');
const { maybeUninstallOAuthMCP } = require('~/server/services/MCP/oauthCleanup');
const subagentThreadTaskStore = require('~/server/services/Endpoints/agents/subagentThreadStore');
const {
  quiesceUserSchedules,
  restoreUserSchedulesFromDeletion,
} = require('~/server/services/Schedules');
const db = require('~/models');
const { getAppConfig, invalidateCodeEnvironmentConfigCache } = require('~/server/services/Config');

const router = express.Router();

const resolveErasure = createErasureResolver({
  withTenant: (tenantId, operation) =>
    tenantId ? tenantStorage.run({ tenantId }, operation) : runAsSystem(operation),
  db,
  getAppConfig,
  getMCPManager,
  processDeleteRequest,
  invalidateCachedTools,
  mcpOAuth: {
    getRegistry: getMCPServersRegistry,
    getUserPrincipals: db.getUserPrincipals,
    uninstallOAuthMCP: maybeUninstallOAuthMCP,
  },
  openCheckpointDeletion,
  deleteSharedLinks: (userId) => deleteAllSharedLinksWithCleanup(userId, { awaitCleanup: true }),
});

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  beginAgentTriggerUserDeletion: db.beginAgentTriggerUserDeletion,
  cancelAgentTriggerUserDeletion: db.cancelAgentTriggerUserDeletion,
  drainAgentTriggerDeliveriesForUser,
  prepareAgentTriggerUserPurge,
  cancelAgentTriggerUserPurge,
  purgeAgentTriggerDeliveriesForUser,
  revokeUserCodeEnvironmentWorkers: async (userId) =>
    revokeUserCodeEnvironmentWorkers({
      mongoose,
      userId,
      appConfig: await getAppConfig({ baseOnly: true }),
    }),
  deleteUserById: db.deleteUserById,
  deleteUserCodeEnvironments: db.deleteUserCodeEnvironments,
  invalidateCodeEnvironmentConfigCache,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  deletePasskeysByUser: db.deletePasskeysByUser,
  resolveErasure,
  cancelSubagentTasks: (userId, tenantId) =>
    subagentThreadTaskStore.cancelAndDrainForOwner(userId, tenantId),
  quiesceUserSchedules,
  restoreUserSchedulesFromDeletion,
  generationJobs: GenerationJobManager,
});

const modelAccess = createAdminModelAccessHandlers({
  findUserModelAccess: (id) => db.findUser({ _id: id }, '_id modelAccess'),
  saveUserModelAccess: (id, value) =>
    db.updateUser(id, { modelAccess: value }, {}, { preserveExpiresAt: true }),
});

const apiAccess = createAdminApiAccessHandlers({
  saveUserApiAccess: (id, value) =>
    db.updateUser(id, { apiAccess: value }, {}, { preserveExpiresAt: true }),
});

const mediaAccess = createAdminMediaAccessHandlers({
  saveUserMediaAccess: (id, value) =>
    db.updateUser(id, { mediaAccess: value }, {}, { preserveExpiresAt: true }),
});

const browserAccess = createAdminBrowserAccessHandlers({
  saveUserBrowserAccess: (id, value) =>
    db.updateUser(id, { browserAccess: value }, {}, { preserveExpiresAt: true }),
});

const attachVmAccess = createAdminAttachVmAccessHandlers({
  saveUserAttachVmAccess: (id, value) =>
    db.updateUser(id, { attachVmAccess: value }, {}, { preserveExpiresAt: true }),
});

const higgsfieldAccess = createAdminHiggsfieldAccessHandlers({
  saveUserHiggsfieldAccess: (id, value) =>
    db.updateUser(id, { higgsfieldAccess: value }, {}, { preserveExpiresAt: true }),
});

/** An admin sets a user's password when they cannot recover it; their sessions end. */
const setPassword = createAdminSetPasswordHandler({
  findUser: (id) => db.findUser({ _id: id }, 'role email provider'),
  hashSecret,
  savePassword: (id, hash) =>
    db.updateUser(id, { password: hash }, {}, { preserveExpiresAt: true }),
  endSessions: (id) => db.deleteAllUserSessions({ userId: id }),
  canManageAdmins: (req) => hasCapability(req.user, SystemCapabilities.MANAGE_ROLES),
  minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH, 10) || 8,
});

const bulkAccess = createAdminBulkAccessHandler({
  findUserModelAccess: (id) => db.findUser({ _id: id }, '_id modelAccess'),
  saveUserModelAccess: (id, value) =>
    db.updateUser(id, { modelAccess: value }, {}, { preserveExpiresAt: true }),
  saveApiAccess: (id, value) =>
    db.updateUser(id, { apiAccess: value }, {}, { preserveExpiresAt: true }),
  saveMediaAccess: (id, value) =>
    db.updateUser(id, { mediaAccess: value }, {}, { preserveExpiresAt: true }),
  saveBrowserAccess: (id, value) =>
    db.updateUser(id, { browserAccess: value }, {}, { preserveExpiresAt: true }),
  saveAttachVmAccess: (id, value) =>
    db.updateUser(id, { attachVmAccess: value }, {}, { preserveExpiresAt: true }),
  saveHiggsfieldAccess: (id, value) =>
    db.updateUser(id, { higgsfieldAccess: value }, {}, { preserveExpiresAt: true }),
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listUsers);
router.post('/bulk-access', requireManageUsers, bulkAccess.updateBulkAccess);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.patch('/:id/model-access', requireManageUsers, modelAccess.updateModelAccess);
router.patch('/:id/api-access', requireManageUsers, apiAccess.updateApiAccess);
router.patch('/:id/media-access', requireManageUsers, mediaAccess.updateMediaAccess);
router.patch('/:id/browser-access', requireManageUsers, browserAccess.updateBrowserAccess);
router.patch('/:id/attach-vm-access', requireManageUsers, attachVmAccess.updateAttachVmAccess);
router.patch('/:id/password', requireManageUsers, setPassword);
router.patch('/:id/higgsfield-access', requireManageUsers, higgsfieldAccess.updateHiggsfieldAccess);
// router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
