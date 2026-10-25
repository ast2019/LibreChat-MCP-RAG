const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { SystemRoles } = require('librechat-data-provider');
const { createPasswordResetUpdate } = require('@librechat/api');
const { createModels, createMethods } = require('@librechat/data-schemas');
const { User, Session } = createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const getLogStores = require('~/cache/getLogStores');
const { registerUser } = require('~/server/services/AuthService');
const { silentExit } = require('./helpers');
const connect = require('./connect');

const methods = createMethods(mongoose, { getCache: getLogStores });

/**
 * Creates an administrator, or turns an existing account into one with a new password.
 * Non-interactive, so it works from the Coolify container terminal.
 *
 *   npm run make-admin -- <email> <password> [name]
 */
(async () => {
  const [rawEmail, password, nameArg] = process.argv.slice(2);
  if (!rawEmail || !password) {
    console.orange('Usage: npm run make-admin -- <email> <password> [name]');
    silentExit(1);
  }
  if (password.length < 8) {
    console.red('Error: password must be at least 8 characters');
    silentExit(1);
  }
  const email = rawEmail.trim().toLowerCase();
  await connect();

  const existing = await User.findOne({ email }).lean();
  if (!existing) {
    const name = nameArg || email.split('@')[0];
    const username =
      email
        .split('@')[0]
        .replace(/[^a-zA-Z0-9_.-]/g, '')
        .slice(0, 20) || 'admin';
    const result = await registerUser(
      { email, password, confirm_password: password, name, username },
      { emailVerified: true, role: SystemRoles.ADMIN },
    );
    if (result.status !== 200) {
      console.red('Error: ' + result.message);
      silentExit(1);
    }
    console.green(`Admin created: ${email}`);
    silentExit(0);
  }

  const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));
  /** Through the data-schemas method so the cached auth user document is invalidated. */
  const updated = await methods.updateUser(
    existing._id.toString(),
    { ...createPasswordResetUpdate(hashedPassword), role: SystemRoles.ADMIN, emailVerified: true },
    {},
    { preserveExpiresAt: true },
  );
  if (!updated) {
    console.red('Error: user disappeared during update');
    silentExit(1);
  }
  try {
    await Session.deleteMany({ user: existing._id });
  } finally {
    await methods.awaitAuthUserDocEviction(existing._id.toString());
  }
  console.green(`Password reset and ADMIN role granted: ${email}`);
  silentExit(0);
})().catch((error) => {
  console.red('Error: ' + error.message);
  silentExit(1);
});
