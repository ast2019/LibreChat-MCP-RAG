const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { createReferralHandlers } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const handlers = createReferralHandlers({
  getAppConfig: (req) =>
    getAppConfig({ role: req.user?.role, userId: req.user?.id, tenantId: req.user?.tenantId }),
  clientOrigin: process.env.DOMAIN_CLIENT || 'http://localhost:3080',
  getOrCreateReferralCode: db.getOrCreateReferralCode,
  attachReferrer: db.attachReferrer,
  claimReferralReward: db.claimReferralReward,
  releaseReferralReward: db.releaseReferralReward,
  getReferralStats: db.getReferralStats,
  getEarnedReferralCredits: (userId) => db.sumCreditsByContext(userId, 'referral'),
  findUser: async (userId) => {
    const user = await db.getUserById(userId, '_id phoneVerified');
    return user ? { id: user._id.toString(), phoneVerified: user.phoneVerified === true } : null;
  },
  createTransaction: db.createTransaction,
  logError: (message, error) => logger.error(message, error),
});

router.use(requireJwtAuth);
router.get('/', handlers.get);
router.post('/claim', handlers.claim);

module.exports = router;
