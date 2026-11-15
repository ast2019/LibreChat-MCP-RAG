/**
 * Public (code-authenticated) debug share snapshot for pasting to an AI helper.
 * Minting stays on /api/admin/debug/share (admin JWT).
 */
const express = require('express');
const { createDebugShareHandlers, preferPublicHttpsBaseUrl } = require('@librechat/api');
const { buildDebugShareSnapshot } = require('~/server/services/Debug/shareSnapshot');

const router = express.Router();

const handlers = createDebugShareHandlers({
  buildSnapshot: buildDebugShareSnapshot,
  publicBaseUrl: () => {
    const raw = process.env.DOMAIN_CLIENT || process.env.DOMAIN_SERVER || undefined;
    return raw ? preferPublicHttpsBaseUrl(raw) : undefined;
  },
});

router.get('/:code', (req, res) => handlers.fetchShare(req, res));

module.exports = { router, mintShare: handlers.mintShare };
