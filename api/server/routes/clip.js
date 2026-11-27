const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const { clipWizardLimiter, clipWizardSampleLimiter } = require('~/server/middleware/limiters/clipWizardLimiters');
const { clipWizard } = require('~/server/services/Clip');

const router = express.Router();

router.use(requireJwtAuth);
router.use(configMiddleware);
router.use('/wizard', clipWizardLimiter);

/** Runs a wizard handler and sends its status and body; behavior lives in `@librechat/api`. */
const handle = (name, run) => async (req, res) => {
  try {
    const reply = await run(req);
    res.status(reply.status).json(reply.body);
  } catch (error) {
    logger.error(`[clip] wizard ${name} failed`, error);
    res.status(500).json({ error: { code: 'server_error' } });
  }
};

router.get('/wizard/config', handle('config', (req) => clipWizard.config(req)));
router.post('/wizard/storyboard/validate', handle('validate', (req) => clipWizard.validate(req)));
router.post('/wizard/voice-sample', clipWizardSampleLimiter, handle('voice-sample', (req) => clipWizard.voiceSample(req)));
router.post('/wizard/render', handle('render', (req) => clipWizard.render(req)));

module.exports = router;
