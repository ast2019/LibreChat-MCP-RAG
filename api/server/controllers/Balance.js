const {
  syncUserTimePackFromBalance,
  applyGrantedTimePackToUser,
  grantedTimePackFromBalance,
  readTimePackStatus,
  getTimePackEntitlement,
  getAppConfigOptionsFromUser,
} = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { findBalanceByUser, setUserTimePack } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');

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
   * Pass packs so a Balance row missing `timePackEndpoint` can still repair from config.
   */
  const packsForSync = req.config?.balance?.packs;
  if (req.user?.id && grantedTimePackFromBalance(balanceData, new Date(), packsForSync) != null) {
    try {
      const synced = await syncUserTimePackFromBalance(
        { findBalanceByUser, setUserTimePack, packs: packsForSync },
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

/**
 * The live capacity of the shared plan: how many seats are in use and how much of the shared
 * request rate the key has spent this minute. Only a holder of the plan gets an answer; anyone
 * else is told there is nothing to see, so the plan's internals stay invisible to them.
 */
async function timePackStatus(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  /**
   * Same sync as `/api/balance` and `/api/config`: the badge can light from the Balance
   * record while this route only read `user.timePack*`, so a grant that had not yet been
   * copied left holders looking at `{ active: false }` (or stale zeros) until another
   * endpoint synced them.
   */
  try {
    const synced = await syncUserTimePackFromBalance(
      {
        findBalanceByUser,
        setUserTimePack,
        packs: req.config?.balance?.packs,
      },
      userId,
      req.user,
    );
    if (synced != null) {
      applyGrantedTimePackToUser(req.user, synced);
    }
  } catch (error) {
    logger.warn('[balance] Time-pack status sync from balance failed:', error);
  }
  const appConfig = await getAppConfig(getAppConfigOptionsFromUser(req.user));
  const balance = appConfig?.balance;
  const entitlement = getTimePackEntitlement(req.user, balance?.packs);
  if (entitlement == null) {
    return res.status(200).json({ active: false });
  }
  const status = await readTimePackStatus({
    userId,
    runtime: balance?.timePack,
  });
  res.status(200).json({ active: true, ...status });
}

module.exports = balanceController;
module.exports.timePackStatus = timePackStatus;
