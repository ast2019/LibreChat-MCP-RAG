const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const { PAYMENT_CHECKOUT_WINDOW = 10, PAYMENT_CHECKOUT_MAX = 10 } = process.env;
const windowMs = PAYMENT_CHECKOUT_WINDOW * 60 * 1000;

/**
 * Caps checkouts per signed-in user: each one creates an order and calls the gateway, so a
 * loop could otherwise flood both. Keyed by user id (the route is behind `requireJwtAuth`).
 */
const paymentCheckoutLimiter = rateLimit({
  windowMs,
  max: PAYMENT_CHECKOUT_MAX,
  handler: (req, res) => res.status(429).json({ error: { code: 'rate_limited' } }),
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('payment_checkout_limiter'),
});

module.exports = paymentCheckoutLimiter;
