const path = require('path');
const mongoose = require('mongoose');
const { getBalanceConfig, resolveBalanceGrant, grantBalance } = require('@librechat/api');
const { User } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { getAppConfig } = require('~/server/services/Config');
const { createTransaction, upsertBalanceFields } = require('~/models');
const { silentExit } = require('./helpers');
const connect = require('./connect');

/**
 * Grants a configured credit pack (or a raw credit amount) to a user and resets their
 * usage bar to the new allotment.
 *
 *   npm run grant-pack -- <email> <packId>
 *   npm run grant-pack -- <email> --credits <amount>
 *   npm run grant-pack -- --list
 */
(async () => {
  await connect();
  const args = process.argv.slice(2);
  const appConfig = await getAppConfig();
  const balanceConfig = getBalanceConfig(appConfig);
  const packs = balanceConfig?.packs ?? [];

  if (args[0] === '--list' || args.length === 0) {
    console.purple('Configured packs (balance.packs in librechat.yaml):');
    for (const pack of packs) {
      const usd = (pack.credits / 1_000_000).toFixed(2);
      console.cyan(`  ${pack.id}  "${pack.label}"  ${pack.credits} credits (~$${usd} of usage)`);
    }
    if (packs.length === 0) {
      console.orange('  (none)');
    }
    console.orange('Usage: npm run grant-pack -- <email> <packId> | <email> --credits <amount>');
    silentExit(0);
  }

  if (!balanceConfig?.enabled) {
    console.red('Error: balance is not enabled in librechat.yaml');
    silentExit(1);
  }

  const [email, second, third] = args;
  const request =
    second === '--credits' ? { credits: Number.parseInt(third, 10) } : { packId: second };
  const resolution = resolveBalanceGrant(packs, request);
  if (!resolution.ok) {
    console.red(`Error: ${resolution.error.message} (${resolution.error.code})`);
    silentExit(1);
  }

  const user = await User.findOne({ email: String(email).trim().toLowerCase() }).lean();
  if (!user) {
    console.red('Error: No user with that email was found!');
    silentExit(1);
  }

  try {
    const result = await grantBalance(
      { createTransaction, upsertBalanceFields },
      {
        userId: user._id.toString(),
        credits: resolution.value.credits,
        pack: resolution.value.pack,
      },
    );
    console.green(
      `Granted ${result.credits} credits${result.pack ? ` (${result.pack.label})` : ''}` +
        ` to ${email}. New balance: ${result.balance}`,
    );
  } catch (error) {
    console.red('Error: ' + error.message);
    console.error(error);
    silentExit(1);
  }

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('There was an uncaught error:');
    console.error(err);
  }

  if (!err.message.includes('fetch failed')) {
    process.exit(1);
  }
});
