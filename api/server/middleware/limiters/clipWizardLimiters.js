const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const {
  CLIP_WIZARD_WINDOW = 1,
  CLIP_WIZARD_MAX = 60,
  CLIP_WIZARD_SAMPLE_WINDOW = 10,
  CLIP_WIZARD_SAMPLE_MAX = 10,
  CLIP_WIZARD_LLM_WINDOW = 10,
  CLIP_WIZARD_LLM_MAX = 20,
} = process.env;

const limited = (req, res) => res.status(429).json({ error: { code: 'rate_limited' } });
const byUser = (req) => req.user?.id;

/** Caps every wizard call per signed-in user (the routes are behind `requireJwtAuth`). */
const clipWizardLimiter = rateLimit({
  windowMs: CLIP_WIZARD_WINDOW * 60 * 1000,
  max: CLIP_WIZARD_MAX,
  handler: limited,
  keyGenerator: byUser,
  store: limiterCache('clip_wizard_limiter'),
});

/**
 * A tighter cap for voice samples: a miss calls a paid provider, and a failed call is not
 * cached, so a loop would otherwise hit the provider on every request.
 */
const clipWizardSampleLimiter = rateLimit({
  windowMs: CLIP_WIZARD_SAMPLE_WINDOW * 60 * 1000,
  max: CLIP_WIZARD_SAMPLE_MAX,
  handler: limited,
  keyGenerator: byUser,
  store: limiterCache('clip_wizard_sample_limiter'),
});

/** A tighter cap for the model calls (draft and chat): each one is a paid provider call. */
const clipWizardLlmLimiter = rateLimit({
  windowMs: CLIP_WIZARD_LLM_WINDOW * 60 * 1000,
  max: CLIP_WIZARD_LLM_MAX,
  handler: limited,
  keyGenerator: byUser,
  store: limiterCache('clip_wizard_llm_limiter'),
});

module.exports = { clipWizardLimiter, clipWizardSampleLimiter, clipWizardLlmLimiter };
