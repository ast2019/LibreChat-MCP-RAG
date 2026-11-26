const express = require('express');
const { createSetBalanceConfig } = require('@librechat/api');
const router = express.Router();
const controller = require('../controllers/Balance');
const { requireJwtAuth } = require('../middleware/');
const { findBalanceByUser, upsertBalanceFields } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

router.get('/', requireJwtAuth, setBalanceConfig, controller);
router.get('/time-pack/status', requireJwtAuth, require('../controllers/Balance').timePackStatus);

module.exports = router;
