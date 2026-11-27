const path = require('path');
const mongoose = require('mongoose');
const { User, Balance } = require('@librechat/data-schemas').createModels(mongoose);
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const connect = require('./connect');

/**
 * Renames the time-pack gateway stored on users and balances (a grant copies the endpoint name
 * once, so renaming the endpoint in the config leaves existing holders on the old name).
 * Requests already derive the gateway from the config, so this only keeps stored data tidy.
 * Dry run by default; pass --apply to write. Safe to run again.
 *
 *   npm run migrate:time-pack-endpoint -- --from=ClaudeTime3D --to=ClaudeTime
 *   npm run migrate:time-pack-endpoint -- --from=ClaudeTime3D --to=ClaudeTime --apply
 */
function readFlag(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : '';
}

(async () => {
  const from = readFlag('from');
  const to = readFlag('to');
  const apply = process.argv.includes('--apply');
  if (!from || !to || from === to) {
    console.red('Usage: --from=<old endpoint> --to=<new endpoint> [--apply]');
    silentExit(1);
    return;
  }
  await connect();
  for (const [label, Model] of [
    ['users', User],
    ['balances', Balance],
  ]) {
    const filter = { timePackEndpoint: from };
    const matching = await Model.countDocuments(filter);
    if (!apply) {
      console.yellow(`[dry run] ${matching} ${label} would change ${from} -> ${to}.`);
      continue;
    }
    const result = await Model.updateMany(filter, { $set: { timePackEndpoint: to } });
    console.green(`Updated ${result.modifiedCount ?? 0} of ${matching} ${label}.`);
  }
  if (apply) {
    console.yellow('Signed-in users see the change after their cached session refreshes.');
  }
  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  console.error('There was an uncaught error:');
  console.error(err);
  process.exit(1);
});
