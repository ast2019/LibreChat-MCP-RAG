const express = require('express');
const {
  hashSecret,
  getBalanceConfig,
  getPrimaryPriceMultiplier,
  createAdminBalanceHandlers,
  createAdminCreateUserHandler,
  createAdminGiftHandlers,
} = require('@librechat/api');
const { SystemRoles, PrincipalType, PrincipalModel } = require('librechat-data-provider');
const { SystemCapabilities, BASE_CONFIG_PRINCIPAL_ID } = require('@librechat/data-schemas');
const { requireCapability, hasCapability } = require('~/server/middleware/roles/capabilities');
const { getAppConfig, invalidateConfigCaches } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const toBillingUser = (user) => (user ? { id: user._id.toString(), email: user.email } : null);

const handlers = createAdminBalanceHandlers({
  getBalanceConfig: async (req) =>
    getBalanceConfig(
      await getAppConfig({
        role: req.user?.role,
        userId: req.user?.id,
        tenantId: req.user?.tenantId,
      }),
    ),
  findUserByEmail: async (email) => toBillingUser(await db.findUser({ email }, '_id email')),
  findUserById: async (id) => toBillingUser(await db.findUser({ _id: id }, '_id email')),
  findBalanceByUser: (userId) => db.findBalanceByUser(userId),
  createTransaction: db.createTransaction,
  upsertBalanceFields: db.upsertBalanceFields,
  listUsersWithBalances: db.listUsersWithBalances,
  getBillingSummary: db.getBillingSummary,
  getUserUsageByContext: db.getUserUsageByContext,
  getPriceMultiplier: async (req) =>
    getPrimaryPriceMultiplier(
      await getAppConfig({
        role: req.user?.role,
        userId: req.user?.id,
        tenantId: req.user?.tenantId,
      }),
    ),
});

const createUser = createAdminCreateUserHandler({
  getAppConfig,
  createUserIfAbsent: db.createUserIfAbsent,
  hashSecret,
  canAssignAdmin: (req) => hasCapability(req.user, SystemCapabilities.MANAGE_ROLES),
  minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH, 10) || 8,
});

/** The sign-up gift and invite rewards, stored as deployment-wide overrides. */
const gifts = createAdminGiftHandlers({
  getAppConfig: (req) => getAppConfig({ role: SystemRoles.USER, tenantId: req.user?.tenantId }),
  getBaseChangedAt: async () =>
    (await db.findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID))?.updatedAt ??
    null,
  patchBaseFields: async (fields) => {
    await db.patchConfigFields(
      PrincipalType.ROLE,
      BASE_CONFIG_PRINCIPAL_ID,
      PrincipalModel.ROLE,
      fields,
    );
  },
  invalidate: invalidateConfigCaches,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/packs', requireReadUsers, handlers.listPacks);
router.get('/user', requireReadUsers, handlers.getUserBalance);
router.post('/grant', requireManageUsers, handlers.grant);
router.get('/users', requireReadUsers, handlers.listUsers);
router.post('/users', requireManageUsers, createUser);
router.get('/summary', requireReadUsers, handlers.summary);
router.get('/gifts', requireReadUsers, gifts.getGifts);
router.put('/gifts', requireManageUsers, gifts.updateGifts);
router.get('/usage', requireReadUsers, handlers.userUsage);

module.exports = router;
