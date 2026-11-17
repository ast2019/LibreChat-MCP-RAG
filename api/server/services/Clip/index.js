const { createClipTools } = require('@librechat/api');
const { saveGeneratedMedia } = require('~/server/services/Files/process');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const db = require('~/models');

/** One of the user's own images as bytes (logo). */
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

/** One of the user's own audio files as bytes (narration upload). */
const loadAudio = async (req, fileId) => {
  const [file] = await db.getFiles({ user: req.user.id, file_id: fileId }, null, {});
  if (!file || !file.type?.startsWith('audio/')) {
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

/**
 * The Remotion clip builder wired to storage; behavior lives in `@librechat/api`.
 * Clips are free (token use of the chat only); the worker caps concurrent renders.
 */
const loadClipTools = (req, toolNames) =>
  createClipTools(
    { req, toolNames },
    { saveMedia: saveGeneratedMedia, loadImage, loadAudio },
  );

module.exports = { loadClipTools };
