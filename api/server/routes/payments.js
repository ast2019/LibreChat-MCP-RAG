const express = require('express');
const {
  createPaymentHandlers,
  getSharedGatewayHealth,
  getSharedCurrencyRates,
} = require('@librechat/api');
const { SystemCapabilities, runAsSystem, tenantStorage } = require('@librechat/data-schemas');
const paymentCheckoutLimiter = require('~/server/middleware/limiters/paymentCheckoutLimiter');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getAppConfig } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createPaymentHandlers({
  getAppConfig: (req) =>
    getAppConfig({ role: req.user?.role, userId: req.user?.id, tenantId: req.user?.tenantId }),
  getTenantAppConfig: (tenantId) => getAppConfig({ tenantId }),
  currencyRates: getSharedCurrencyRates(),
  store: db,
  grant: { createTransaction: db.createTransaction, upsertBalanceFields: db.upsertBalanceFields },
  health: getSharedGatewayHealth(),
  asSystem: runAsSystem,
  withTenant: (tenantId, fn) => (tenantId ? tenantStorage.run({ tenantId }, fn) : fn()),
});

/** The buyer's browser returns here from the gateway, without our auth cookies being certain. */
router.get('/callback/:gateway', handlers.callback);
router.post('/callback/:gateway', handlers.callback);

router.get('/options', requireJwtAuth, handlers.options);
router.post('/checkout', requireJwtAuth, paymentCheckoutLimiter, handlers.checkout);
router.get('/orders/:orderId', requireJwtAuth, handlers.getOrder);

router.use('/admin', requireJwtAuth, requireAdminAccess);
router.get('/admin/orders', requireReadUsers, handlers.adminList);
router.get('/admin/summary', requireReadUsers, handlers.adminSummary);
router.get('/admin/status', requireReadUsers, handlers.adminStatus);
router.post('/admin/orders/:orderId/verify', requireManageUsers, handlers.adminVerify);
router.post('/admin/reconcile', requireManageUsers, handlers.adminReconcile);

module.exports = router;
