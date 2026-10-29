const { createMediaTools, createMediaBilling } = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { saveGeneratedMedia } = require('~/server/services/Files/process');
const db = require('~/models');

/** In-chat image, video and speech tools wired to storage and the ledger; behavior lives in
 *  `@librechat/api`. */
const billing = createMediaBilling({
  reserveBalance: db.reserveBalance,
  renewBalanceReservation: db.renewBalanceReservation,
  releaseBalanceReservation: db.releaseBalanceReservation,
  logViolation: (...args) => require('~/cache').logViolation(...args),
  createTransaction: db.createTransaction,
});

/** One of the user's own images as bytes, for edits and image-to-video. */
const loadImage = async (req, fileId) => {
  const [file] = await db.getFiles({ user: req.user.id, file_id: fileId }, null, {});
  if (!file || !file.type?.startsWith('image/')) {
    return null;
  }
  const { getDownloadStream } = getStrategyFunctions(file.source);
  if (!getDownloadStream) {
    return null;
  }
  const stream = await getDownloadStream(req, file.filepath);
  if (!stream) {
    return null;
  }
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), type: file.type };
};

const loadMediaTools = (req, toolNames) =>
  createMediaTools(
    { req, toolNames },
    {
      billing,
      findBalanceByUser: db.findBalanceByUser,
      saveMedia: saveGeneratedMedia,
      loadImage,
    },
  );

module.exports = { loadMediaTools };
