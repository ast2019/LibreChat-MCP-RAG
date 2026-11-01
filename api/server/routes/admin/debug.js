/**
 * Admin «دیباگ»: the temporary debug switch, the chat requests it traced and this server's
 * recent log lines. Every route needs ACCESS_ADMIN; reading needs READ_CONFIGS, and switching
 * it or clearing traces needs MANAGE_CONFIGS.
 */
const express = require('express');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { createDebugAdminHandlers } = require('@librechat/api');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { debugMode, debugTraces, getSystemLog } = require('~/server/services/Debug');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadConfigs = requireCapability(SystemCapabilities.READ_CONFIGS);
const requireManageConfigs = requireCapability(SystemCapabilities.MANAGE_CONFIGS);

const handlers = createDebugAdminHandlers({ debugMode, traces: debugTraces, getSystemLog });

router.use(requireJwtAuth, requireAdminAccess);
router.get('/', requireReadConfigs, handlers.getDebugMode);
router.post('/', requireManageConfigs, handlers.updateDebugMode);
router.get('/traces', requireReadConfigs, handlers.listTraces);
router.delete('/traces', requireManageConfigs, handlers.clearTraces);
router.get('/traces/:id', requireReadConfigs, handlers.getTrace);
router.get('/logs', requireReadConfigs, handlers.getLogs);

module.exports = router;
