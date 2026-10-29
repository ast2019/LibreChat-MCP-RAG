const { resolveApiAgent, listApiModelSpecs } = require('@librechat/api');
const { getMCPServerTools } = require('~/server/services/Config');
const { getAccessibleMCPServers } = require('~/server/services/MCP');
const db = require('~/models');

/** The agent an API call runs: a stored agent by id, or the ephemeral agent of a model spec. */
const loadApiAgent = (req, model) =>
  resolveApiAgent(req, model, {
    getAgent: db.getAgent,
    getMCPServerTools,
    getAccessibleMCPServers,
  });

module.exports = { loadApiAgent, listApiModelSpecs };
