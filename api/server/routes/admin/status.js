const express = require('express');
const { createAdminStatusHandlers, createAdminHiggsfieldHandlers } = require('@librechat/api');
const { SystemRoles, PrincipalType, PrincipalModel } = require('librechat-data-provider');
const { SystemCapabilities, BASE_CONFIG_PRINCIPAL_ID } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getAppConfig, invalidateConfigCaches } = require('~/server/services/Config');
const { getServiceStatus, higgsfieldStatusDeps } = require('~/server/services/ServiceStatus');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
const handlers = createAdminStatusHandlers(getServiceStatus());

/** Higgsfield's setup and the shared account's owner, stored as a deployment-wide override. */
const higgsfield = createAdminHiggsfieldHandlers({
  ...higgsfieldStatusDeps,
  getAppConfig: (req) => getAppConfig({ role: SystemRoles.USER, tenantId: req.user?.tenantId }),
  patchBaseFields: async (fields) => {
    await db.patchConfigFields(
      PrincipalType.ROLE,
      BASE_CONFIG_PRINCIPAL_ID,
      PrincipalModel.ROLE,
      fields,
    );
  },
  unsetBaseFields: async (paths) => {
    await db.unsetConfigField(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID, paths);
  },
  invalidate: invalidateConfigCaches,
});

router.use(requireJwtAuth, requireCapability(SystemCapabilities.ACCESS_ADMIN));

router.get('/', handlers.get);
router.post('/refresh', handlers.refresh);
router.get(
  '/higgsfield',
  requireCapability(SystemCapabilities.READ_USERS),
  higgsfield.getHiggsfield,
);
router.put(
  '/higgsfield',
  requireCapability(SystemCapabilities.MANAGE_USERS),
  higgsfield.updateHiggsfield,
);

module.exports = router;
