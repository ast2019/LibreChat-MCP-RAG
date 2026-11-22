const { logger } = require('@librechat/data-schemas');
const {
  createClipTools,
  createClipJobRunner,
  createClipImageService,
  getRemotionServiceTarget,
  createRemotionServiceClient,
  getAppConfigOptionsFromUser,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { saveGeneratedMedia } = require('~/server/services/Files/process');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { billing } = require('~/server/services/Media');
const db = require('~/models');

/** One of the user's own files of a mime prefix as bytes; null when missing or not theirs. */
const loadOwnFile = async (req, fileId, prefix) => {
  const [file] = await db.getFiles({ user: req.user.id, file_id: fileId }, null, {});
  if (!file || !file.type?.startsWith(prefix)) {
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
const loadImage = (req, fileId) => loadOwnFile(req, fileId, 'image/');
const loadAudio = (req, fileId) => loadOwnFile(req, fileId, 'audio/');

/** AI images for clips go through the image tool's path and ledger. */
const images = createClipImageService({ billing, findBalanceByUser: db.findBalanceByUser });

/** The storyboard clip builder wired to storage and jobs; behavior lives in `@librechat/api`. */
const loadClipTools = (req, toolNames) =>
  createClipTools(
    { req, toolNames },
    {
      createMediaJob: db.createMediaJob,
      countPendingMediaJobs: db.countPendingMediaJobs,
      loadImage,
      loadAudio,
      images,
    },
  );

/** The job owner as a request, for loading their files and saving the clip. */
const loadOwnerRequest = async (job) => {
  const user = await db.getUserById(job.user, '-password -__v -totpSecret -backupCodes');
  if (!user) {
    return null;
  }
  user.id = user._id.toString();
  const config = await getAppConfig(getAppConfigOptionsFromUser(user));
  return { user, config };
};

const POLL_EVERY_MS = 3_000;
let worker;

/** Drives background clip jobs on the Remotion worker (its own loop, apart from videos). */
const startClipJobWorker = () => {
  if (worker) {
    return worker;
  }
  const runner = createClipJobRunner({
    claimDueMediaJobs: db.claimDueMediaJobs,
    updateMediaJob: db.updateMediaJob,
    loadOwnerRequest,
    saveMedia: saveGeneratedMedia,
    loadImage,
    loadAudio,
    images,
    client: () => {
      const target = getRemotionServiceTarget();
      return target ? createRemotionServiceClient(target) : null;
    },
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
      logger.error('[clip] job worker tick failed', error);
    } finally {
      running = false;
    }
  }, POLL_EVERY_MS);
  worker.unref?.();
  return worker;
};

module.exports = { loadClipTools, startClipJobWorker };
