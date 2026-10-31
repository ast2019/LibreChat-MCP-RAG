const { createApiRequestLimiter, limiterCache } = require('@librechat/api');

/** Model calls of the programming API per user, as `rateLimits.api` sets them. */
const apiRequestLimiter = createApiRequestLimiter({ createStore: limiterCache });

module.exports = { apiRequestLimiter };
