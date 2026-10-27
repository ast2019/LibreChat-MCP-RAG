const { createDocumentOcrService, createDocumentTextConverter } = require('@librechat/api');
const db = require('~/models');

/** `documentOcr` wired to the database methods; behavior lives in `@librechat/api`. Built on
 *  first use, and the violation cache is read only then, so requiring this module (as every
 *  file route does) has no side effects. */
let service;
const getService = () =>
  (service ??= createDocumentOcrService({
    getMultiplier: db.getMultiplier,
    spendTokens: db.spendTokens,
    createTransaction: db.createTransaction,
    reserveBalance: db.reserveBalance,
    renewBalanceReservation: db.renewBalanceReservation,
    releaseBalanceReservation: db.releaseBalanceReservation,
    logViolation: (...args) => require('~/cache').logViolation(...args),
    getConvo: db.getConvo,
  }));

/** @type {import('@librechat/api').DocumentOcrService} */
const documentOcrService = {
  getConfig: (appConfig) => getService().getConfig(appConfig),
  resolveUploadContext: (req, fields) => getService().resolveUploadContext(req, fields),
  extract: (params) => getService().extract(params),
};

let converter;
const getConverter = () =>
  (converter ??= createDocumentTextConverter({
    service: documentOcrService,
    saveFileText: db.saveFileExtractedText,
  }));

/** @type {import('@librechat/api').DocumentTextConverter} */
const documentTextConverter = {
  needsText: (req, params) => getConverter().needsText(req, params),
  getText: (req, file, pdf, params) => getConverter().getText(req, file, pdf, params),
};

module.exports = { documentOcrService, documentTextConverter };
