const { handleError } = require('@librechat/api');
const { resolveModelCatalogKey, ViolationTypes, ErrorTypes } = require('librechat-data-provider');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { getEndpointsConfig } = require('~/server/services/Config');
const { logViolation } = require('~/cache');

const MAX_MODEL_STRING_LENGTH = 256;
const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]*$/;

/**
 * Validates the model of the request.
 *
 * @async
 * @param {ServerRequest} req - The Express request object.
 * @param {Express.Response} res - The Express response object.
 * @param {Function} next - The Express next function.
 */
/**
 * Refuses with a typed payload the client error registry localizes; `message` keeps the English
 * text for logs and older readers.
 *
 * @param {Express.Response} res
 * @param {Record<string, string>} payload
 */
const refuse = (res, payload) => handleError(res, { text: JSON.stringify(payload) });

const validateModel = async (req, res, next) => {
  const { endpoint } = req.body;
  const rawModel = req.body.model;

  if (!rawModel || typeof rawModel !== 'string') {
    return refuse(res, {
      type: ErrorTypes.MISSING_MODEL,
      info: endpoint,
      message: 'Model not provided',
    });
  }

  const model = rawModel.trim();
  if (!model || model.length > MAX_MODEL_STRING_LENGTH || !MODEL_PATTERN.test(model)) {
    return refuse(res, {
      type: ViolationTypes.ILLEGAL_MODEL_REQUEST,
      info: `${endpoint ?? ''}|`,
      message: 'Invalid model identifier',
    });
  }

  req.body.model = model;

  const endpointsConfig = await getEndpointsConfig(req);
  const endpointConfig = endpointsConfig?.[endpoint];

  if (endpointConfig?.userProvide) {
    return next();
  }

  const modelsConfig = await getModelsConfig(req);

  if (!modelsConfig) {
    return refuse(res, { type: ErrorTypes.MODELS_NOT_LOADED, message: 'Models not loaded' });
  }

  const availableModels = modelsConfig[resolveModelCatalogKey(endpoint, modelsConfig)];
  if (!availableModels) {
    return refuse(res, {
      type: ErrorTypes.ENDPOINT_MODELS_NOT_LOADED,
      info: endpoint,
      message: 'Endpoint models not loaded',
    });
  }

  let validModel = !!availableModels.find((availableModel) => availableModel === model);

  if (validModel) {
    return next();
  }

  const { ILLEGAL_MODEL_REQ_SCORE: score = 1 } = process.env ?? {};

  const type = ViolationTypes.ILLEGAL_MODEL_REQUEST;
  const errorMessage = {
    type,
  };

  await logViolation(req, res, type, errorMessage, score);
  return refuse(res, {
    type,
    info: `${endpoint ?? ''}|${model}`,
    message: 'Illegal model request',
  });
};

module.exports = validateModel;
