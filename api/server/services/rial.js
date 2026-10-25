const { createRialRateRegistry } = require('@librechat/api');

/** The process-wide USD to rial rate cache, shared by the user and admin balance routes. */
module.exports = createRialRateRegistry({ fetch: globalThis.fetch });
