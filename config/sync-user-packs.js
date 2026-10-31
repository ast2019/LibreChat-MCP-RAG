const path = require('path');
const mongoose = require('mongoose');
const { User, Balance } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const connect = require('./connect');

/**
 * Copies each balance's current pack onto its user (`user.packId`), once, for accounts granted a
 * pack before packs could grant access. New grants copy it themselves. Safe to run again.
 *
 *   npm run sync-user-packs
 */
(async () => {
  await connect();
  const balances = await Balance.find(
    { packId: { $exists: true, $nin: [null, ''] } },
    'user packId',
  ).lean();
  let updated = 0;
  for (const balance of balances) {
    const result = await User.updateOne(
      { _id: balance.user, packId: { $ne: balance.packId } },
      { $set: { packId: balance.packId } },
    );
    updated += result.modifiedCount ?? 0;
  }
  console.green(`Copied the pack onto ${updated} of ${balances.length} users with a pack.`);
  console.yellow('Signed-in users see the change after their cached session refreshes.');
  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  process.exit(1);
});
