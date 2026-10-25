const express = require('express');
const {
  getBalanceConfig,
  createSetBalanceConfig,
  createBalancePacksHandler,
} = require('@librechat/api');
const router = express.Router();
const controller = require('../controllers/Balance');
const { requireJwtAuth } = require('../middleware/');
const { findBalanceByUser, upsertBalanceFields } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const rialRates = require('~/server/services/rial');

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

const listPacks = createBalancePacksHandler({
  rialRates,
  getBalanceConfig: async (req) =>
    getBalanceConfig(
      await getAppConfig({
        role: req.user?.role,
        userId: req.user?.id,
        tenantId: req.user?.tenantId,
      }),
    ),
});

router.get('/packs', requireJwtAuth, listPacks);
router.get('/', requireJwtAuth, setBalanceConfig, controller);

module.exports = router;
