const { logger } = require('@librechat/data-schemas');
const {
  createMediaTools,
  createMediaBilling,
  createMediaJobRunner,
  getAppConfigOptionsFromUser,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
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
      createMediaJob: db.createMediaJob,
    },
  );

/** The job owner as a request, for saving their file and charging their balance. */
const loadOwnerRequest = async (job) => {
  const user = await db.getUserById(job.user, '-password -__v -totpSecret -backupCodes');
  if (!user) {
    return null;
  }
  user.id = user._id.toString();
  const config = await getAppConfig(getAppConfigOptionsFromUser(user));
  return { user, config };
};

const POLL_EVERY_MS = 5_000;
let worker;

/** Polls background generations (videos) and delivers each when the provider finishes. */
const startMediaJobWorker = () => {
  if (worker) {
    return worker;
  }
  const runner = createMediaJobRunner({
    claimDueMediaJobs: db.claimDueMediaJobs,
    updateMediaJob: db.updateMediaJob,
    loadOwnerRequest,
    saveMedia: saveGeneratedMedia,
    billing,
  });
  let running = false;
  worker = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await runner.tick();
    } catch (error) {
      logger.error('[media] job worker tick failed', error);
    } finally {
      running = false;
    }
  }, POLL_EVERY_MS);
  worker.unref?.();
  return worker;
};

module.exports = { loadMediaTools, loadImage, startMediaJobWorker };
