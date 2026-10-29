const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  generateCheckAccess,
  preAuthTenantMiddleware,
  createRequireApiKeyAuth,
  createRemoteAgentAuth,
  createAgentManagementAuth,
  createCheckAgentTriggerAccess,
  createCheckRemoteAgentAccess,
  createCheckApiAccess,
  createRequireApiBalance,
} = require('@librechat/api');
const { getEffectivePermissions } = require('~/server/services/PermissionService');
const { getAppConfig } = require('~/server/services/Config');
const checkBan = require('~/server/middleware/checkBan');
const db = require('~/models');

const apiKeyMiddleware = createRequireApiKeyAuth({
  validateAgentApiKey: db.validateAgentApiKey,
  findUser: db.findUser,
  isPrincipalActive: db.isAgentTriggerPrincipalActive,
});

const requireRemoteAgentAuth = createRemoteAgentAuth({
  apiKeyMiddleware,
  findUser: db.findUser,
  getRolesByNames: db.findRolesByNames,
  updateUser: db.updateUser,
  isPrincipalActive: db.isAgentTriggerPrincipalActive,
  getAppConfig,
  recordAuditEntry: db.recordAuditEntry,
});

const requireAgentManagementAuth = createAgentManagementAuth({
  findUser: db.findUser,
  isPrincipalActive: db.isAgentTriggerPrincipalActive,
  getAppConfig,
});

const checkRemoteAgentsRole = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName: db.getRoleByName,
});

/** A banned account is refused like in chat; then the user's own API switch, then the role. */
const checkRemoteAgentsFeature = [checkBan, createCheckApiAccess(checkRemoteAgentsRole)];

/** No credit, no call: refused before any provider is reached. */
const requireApiBalance = createRequireApiBalance({
  findBalanceByUser: db.findBalanceByUser,
});

const agentAccessDependencies = {
  getAgent: db.getAgent,
  getEffectivePermissions,
};

const checkAgentPermission = createCheckRemoteAgentAccess(agentAccessDependencies);
const checkAgentTriggerPermission = createCheckAgentTriggerAccess(agentAccessDependencies);

module.exports = {
  checkAgentPermission,
  checkAgentTriggerPermission,
  preAuthTenantMiddleware,
  requireRemoteAgentAuth,
  requireAgentManagementAuth,
  checkRemoteAgentsFeature,
  requireApiBalance,
};
