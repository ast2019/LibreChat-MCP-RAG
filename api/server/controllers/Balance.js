const {
  syncUserTimePackFromBalance,
  applyGrantedTimePackToUser,
  grantedTimePackFromBalance,
} = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { findBalanceByUser, setUserTimePack } = require('~/models');

async function balanceController(req, res) {
  const balanceLocals = res.locals || {};

  if (balanceLocals.balanceConfigEnabled === false) {
    return res.sendStatus(204);
  }

  const balanceData = balanceLocals.balanceData ?? (await findBalanceByUser(req.user.id));

  if (!balanceData) {
    return res.status(404).json({ error: 'Balance not found' });
  }

  /**
   * When the balance holds an active time pack the user document does not, copy it so the
   * next `/api/config` (and seat admission) see ClaudeTime instead of OpenRouter Claude.
   */
  if (req.user?.id && grantedTimePackFromBalance(balanceData) != null) {
    try {
      const synced = await syncUserTimePackFromBalance(
        { findBalanceByUser, setUserTimePack },
        req.user.id,
        req.user,
      );
      if (synced != null) {
        applyGrantedTimePackToUser(req.user, synced);
      }
    } catch (error) {
      logger.warn('[balance] Time-pack sync from balance failed:', error);
    }
  }

  const { _id: _, ...result } = balanceData;

  if (!result.autoRefillEnabled) {
    delete result.refillIntervalValue;
    delete result.refillIntervalUnit;
    delete result.lastRefill;
    delete result.refillAmount;
  }

  res.status(200).json(result);
}

module.exports = balanceController;
