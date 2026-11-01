const fs = require('fs/promises');
const path = require('path');
const { logger } = require('@librechat/data-schemas');
const { createOfficeTools } = require('@librechat/api');
const { saveGeneratedDocument } = require('~/server/services/Files/process');
const { loadImage } = require('~/server/services/Media');

/** Vazirmatn 33.003 (SIL Open Font License, `fonts/Vazirmatn-OFL.txt`), embedded in Word files. */
const FONTS_DIR = path.join(__dirname, 'fonts');

let fonts;
/** Reads the two faces once per process; a missing file leaves Word files without the font. */
const loadFonts = () => {
  fonts ??= Promise.all([
    fs.readFile(path.join(FONTS_DIR, 'Vazirmatn-Regular.ttf')),
    fs.readFile(path.join(FONTS_DIR, 'Vazirmatn-Bold.ttf')),
  ])
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((error) => {
      logger.warn('[office] Vazirmatn could not be read; Word files will not embed it', error);
      return null;
    });
  return fonts;
};

/** The Word and PowerPoint builders wired to storage and the user's images; behavior lives in
 *  `@librechat/api`. */
const loadOfficeTools = (req, toolNames) =>
  createOfficeTools(
    { req, toolNames },
    { saveDocument: saveGeneratedDocument, loadImage, loadFonts },
  );

module.exports = { loadOfficeTools };
