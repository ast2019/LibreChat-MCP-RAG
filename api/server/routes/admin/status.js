const express = require('express');
const { createAdminStatusHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getServiceStatus } = require('~/server/services/ServiceStatus');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
const handlers = createAdminStatusHandlers(getServiceStatus());

router.use(requireJwtAuth, requireCapability(SystemCapabilities.ACCESS_ADMIN));

router.get('/', handlers.get);
router.post('/refresh', handlers.refresh);

module.exports = router;
