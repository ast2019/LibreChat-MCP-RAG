const { createHiveSpeechService, createHiveSpeechHttp } = require('@librechat/api');

/** `speech.*.hive` wired to the database methods; behavior lives in `@librechat/api`. Built on
 *  first use, so requiring this module has no side effects. */
let http;
const getHiveSpeech = () => {
  if (http) {
    return http;
  }
  const db = require('~/models');
  http = createHiveSpeechHttp(
    createHiveSpeechService({
      getMultiplier: db.getMultiplier,
      createTransaction: db.createTransaction,
      reserveBalance: db.reserveBalance,
      renewBalanceReservation: db.renewBalanceReservation,
      releaseBalanceReservation: db.releaseBalanceReservation,
      logViolation: (...args) => require('~/cache').logViolation(...args),
      getConvo: db.getConvo,
    }),
  );
  return http;
};

module.exports = { getHiveSpeech };
