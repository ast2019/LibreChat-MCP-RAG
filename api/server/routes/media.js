const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { getMediaAvailability, toMediaJobView } = require('@librechat/api');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

router.use(requireJwtAuth);

/** Every way this user can make images and videos, and what each one needs. */
router.get('/status', configMiddleware, async (req, res) => {
  try {
    const availability = await getMediaAvailability(req.config, req.user, {
      findBalanceByUser: db.findBalanceByUser,
      hasMcpConnection: async (userId, serverName) =>
        Boolean(await db.findToken({ userId, type: 'mcp_oauth', identifier: `mcp:${serverName}` })),
      findUserIdByEmail: async (email) => {
        const user = await db.findUser({ email }, '_id');
        return user?._id ? user._id.toString() : null;
      },
    });
    res.json(availability);
  } catch (error) {
    logger.error('[media] status failed', error);
    res.status(500).json({ error: { code: 'media_status_failed' } });
  }
});

/** One of the user's background generations, for the card in the chat. */
router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await db.findMediaJobForUser(req.params.id, req.user.id);
    if (!job) {
      return res.status(404).json({ error: { code: 'not_found' } });
    }
    res.json(toMediaJobView(job));
  } catch (error) {
    logger.error('[media] job read failed', error);
    res.status(500).json({ error: { code: 'media_job_failed' } });
  }
});

module.exports = router;
