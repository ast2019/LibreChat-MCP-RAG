const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const {
  CLIP_WIZARD_WINDOW = 1,
  CLIP_WIZARD_MAX = 60,
  CLIP_WIZARD_SAMPLE_WINDOW = 10,
  CLIP_WIZARD_SAMPLE_MAX = 10,
  CLIP_WIZARD_PREVIEW_WINDOW = 10,
  CLIP_WIZARD_PREVIEW_MAX = 20,
  CLIP_WIZARD_STYLE_WINDOW = 10,
  CLIP_WIZARD_STYLE_MAX = 60,
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

/**
 * A tighter cap for key-frame previews: each one occupies the render worker's single preview
 * slot for up to `previewTimeoutSec`.
 */
const clipWizardPreviewLimiter = rateLimit({
  windowMs: CLIP_WIZARD_PREVIEW_WINDOW * 60 * 1000,
  max: CLIP_WIZARD_PREVIEW_MAX,
  handler: limited,
  keyGenerator: byUser,
  store: limiterCache('clip_wizard_preview_limiter'),
});

/**
 * A cap for style sample pictures: a cold theme render holds the worker's single preview slot
 * (shared with key-frame previews). Cached hits are cheap, so the cap fits a full theme grid.
 */
const clipWizardStyleLimiter = rateLimit({
  windowMs: CLIP_WIZARD_STYLE_WINDOW * 60 * 1000,
  max: CLIP_WIZARD_STYLE_MAX,
  handler: limited,
  keyGenerator: byUser,
  store: limiterCache('clip_wizard_style_limiter'),
});

/** A tighter cap for the model calls (draft and chat): each one is a paid provider call. */
const clipWizardLlmLimiter = rateLimit({
  windowMs: CLIP_WIZARD_LLM_WINDOW * 60 * 1000,
  max: CLIP_WIZARD_LLM_MAX,
  handler: limited,
  keyGenerator: byUser,
  store: limiterCache('clip_wizard_llm_limiter'),
});

module.exports = {
  clipWizardLimiter,
  clipWizardSampleLimiter,
  clipWizardPreviewLimiter,
  clipWizardStyleLimiter,
  clipWizardLlmLimiter,
};
