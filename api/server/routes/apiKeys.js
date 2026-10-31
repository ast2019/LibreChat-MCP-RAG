const express = require('express');
const {
  generateCheckAccess,
  createApiKeyHandlers,
  createCheckApiAccess,
} = require('@librechat/api');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  getAgentApiKeyById,
  createAgentApiKey,
  deleteAgentApiKey,
  listAgentApiKeys,
  getRoleByName,
} = require('~/models');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');

const router = express.Router();

const handlers = createApiKeyHandlers({
  createAgentApiKey,
  listAgentApiKeys,
  deleteAgentApiKey,
  getAgentApiKeyById,
});

/** The user's own API switch (set on the admin page) wins over the role. */
const checkRemoteAgentsUse = createCheckApiAccess(
  generateCheckAccess({
    permissionType: PermissionTypes.REMOTE_AGENTS,
    permissions: [Permissions.USE],
    getRoleByName,
  }),
);

/** The config carries the packs whose `grants.api` the check reads */
router.post('/', requireJwtAuth, configMiddleware, checkRemoteAgentsUse, handlers.createApiKey);

router.get('/', requireJwtAuth, configMiddleware, checkRemoteAgentsUse, handlers.listApiKeys);

router.get('/:id', requireJwtAuth, configMiddleware, checkRemoteAgentsUse, handlers.getApiKey);

router.delete(
  '/:id',
  requireJwtAuth,
  configMiddleware,
  checkRemoteAgentsUse,
  handlers.deleteApiKey,
);

module.exports = router;
