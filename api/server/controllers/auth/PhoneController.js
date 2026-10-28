const { getTenantId } = require('@librechat/data-schemas');
const {
  removePorts,
  limiterCache,
  compareSecret,
  standardCache,
  comparePassword,
  createPhoneLimiters,
  createKavenegarClient,
  createPhoneAuthHandlers,
  createKavenegarSmsProvider,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { checkBan } = require('~/server/middleware');
const { logViolation } = require('~/cache');
const db = require('~/models');

/** Fails closed on a store outage instead of reading it as "no code". */
const getStore = () => standardCache('phone_otp', undefined, undefined, { throwOnErrors: true });

const handlers = createPhoneAuthHandlers({
  env: process.env,
  getAppConfig,
  getStore,
  secret: process.env.JWT_SECRET,
  createSmsProvider: (config) =>
    createKavenegarSmsProvider({
      client: createKavenegarClient({ apiKey: process.env.KAVENEGAR_API_KEY ?? '' }),
      template: config.template,
      sender: config.sender,
    }),
  findUserByPhone: (phone) => db.findUser({ phone }),
  getUserById: db.getUserById,
  createUserIfAbsent: db.createUserIfAbsent,
  countUsers: () => db.countUsers(),
  getTenantId,
  updateUser: db.updateUser,
  unsetUserPhone: db.unsetUserPhone,
  comparePassword: (user, password) => comparePassword(user, password, { compare: compareSecret }),
  checkBan,
});

const limiters = createPhoneLimiters({
  limiterCache,
  removePorts,
  logViolation,
  resolveLimits: handlers.resolveLimits,
  violationScore: process.env.LOGIN_VIOLATION_SCORE,
});

module.exports = { ...handlers, ...limiters };
