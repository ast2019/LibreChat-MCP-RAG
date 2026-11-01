/**
 * Admin «وضعیت سرور» and «لاگ مرورگر»: server RAM and CPU, open agent browsers with a
 * force-close, and the browser log. Every route needs ACCESS_ADMIN plus the users capability.
 */
const express = require('express');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { createBrowserAdminHandlers } = require('@librechat/api');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getBrowserClient, browserLog } = require('~/server/services/Browser');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createBrowserAdminHandlers({
  getClient: getBrowserClient,
  log: browserLog,
  findUsersByIds: (ids) => db.findUsers({ _id: { $in: ids } }, '_id name email'),
});

router.use(requireJwtAuth, requireAdminAccess);
router.get('/', requireReadUsers, handlers.getServerStatus);
router.get('/browser-log', requireReadUsers, handlers.listBrowserLog);
router.post('/sessions/:id/close', requireManageUsers, handlers.closeSession);

module.exports = router;
