/**
 * The signed-in user's own agent browser (experimental): which one is open in a conversation,
 * its live view, the user's input, taking it from the model and giving it back, and closing it.
 * Behavior lives in `@librechat/api`.
 */
const express = require('express');
const { createBrowserUserHandlers } = require('@librechat/api');
const { getBrowserClient, browserLog } = require('~/server/services/Browser');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');

const router = express.Router();
const handlers = createBrowserUserHandlers({ getClient: getBrowserClient, log: browserLog });

router.use(requireJwtAuth, configMiddleware);
router.get('/session', handlers.getSession);
router.get('/sessions/:id/view', handlers.view);
router.post('/sessions/:id/input', handlers.input);
router.post('/sessions/:id/control', handlers.control);
router.delete('/sessions/:id', handlers.close);

module.exports = router;
