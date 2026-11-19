import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import multer from 'multer';
import { HttpError } from '../errors.js';
import { readHead } from '../storage.js';

const FORMAT_BY_EXTENSION = { '.step': 'step', '.stp': 'step', '.glb': 'glb' };
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// Streams the upload to storage/tmp under a random name; the route decides
// where it goes after checking it.
export function createUploadMiddleware({ storage, maxBytes }) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: storage.tmpDir,
      filename: (req, file, done) => done(null, randomUUID()),
    }),
    limits: { fileSize: maxBytes, files: 1, fields: 5, fieldSize: 1024 },
    defParamCharset: 'utf8', // keep non-ASCII filenames intact
  }).single('file');

  return (req, res, next) =>
    upload(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new HttpError(413, `File is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
      }
      if (error instanceof multer.MulterError) {
        return next(new HttpError(400, `Upload rejected: ${error.message}`));
      }
      return next(error);
    });
}

// Decides the format from the extension, then checks the file's first bytes
// actually match, so a renamed .exe can't pass as a .step.
export async function detectFormat(file) {
  const format = FORMAT_BY_EXTENSION[extname(file.originalname).toLowerCase()];
  if (!format) throw new HttpError(400, 'Only .step, .stp and .glb files are supported');

  let head = await readHead(file.path);
  if (format === 'glb') {
    if (head.toString('latin1', 0, 4) !== 'glTF') {
      throw new HttpError(400, `${file.originalname} doesn't look like a GLB file`);
    }
    return format;
  }

  if (head.subarray(0, 3).equals(UTF8_BOM)) head = head.subarray(3);
  if (!head.toString('latin1').trimStart().startsWith('ISO-10303-21;')) {
    throw new HttpError(400, `${file.originalname} doesn't look like a STEP file`);
  }
  return format;
}

export function defaultModelName(originalFilename) {
  const base = originalFilename.replace(/\.[^.]+$/, '').trim();
  return base || 'Untitled model';
}
