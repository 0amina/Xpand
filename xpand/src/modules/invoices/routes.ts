import { Router } from 'express';
import multer, { MulterError } from 'multer';

import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError } from '../../utils/AppError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  confirm,
  getFile,
  getOne,
  getRawText,
  link,
  list,
  remove,
  retry,
  upload,
} from './controller.js';
import { rejectionForMimeType } from './storage.js';

/**
 * Invoice routes.
 *
 * Open to any authenticated user, reads and writes alike, like the rest of the API.
 *
 * The flow across these endpoints:
 *
 *   POST /                 upload → 201, status PENDING, OCR starts in the background
 *   GET  /:id              poll until status leaves PENDING/PROCESSING; carries `draft`
 *   GET  /:id/file         the stored image, for the review screen
 *   POST /:id/retry-ocr    read the page again (also unsticks a PROCESSING row)
 *   POST /:id/confirm      the user's verified values → creates the transaction
 *   POST /:id/link         attach to a transaction that already exists (creates nothing)
 *   DELETE /:id            discard an unconfirmed invoice
 */
export const invoicesRouter = Router();

/**
 * Multipart parsing.
 *
 * Memory storage, not disk: the file has to be validated (type, size) and handed to Tesseract as
 * a buffer anyway, and writing it before it is accepted would leave rejected uploads littering
 * `UPLOAD_DIR`. `storage.ts` owns the write once the file passes.
 *
 * `limits.fileSize` makes multer abort a too-large stream partway rather than buffering the whole
 * thing before anyone checks — the controller's size check is the backstop, this is the defence.
 */
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Reject with the *reason*, not with `false`. Passing `false` makes multer drop the part
    // silently, and the controller then sees no file at all and reports "nothing was uploaded" —
    // which hides the actual problem (a PDF, say) behind a misleading message.
    const rejection = rejectionForMimeType(file.mimetype);
    if (rejection) cb(rejection);
    else cb(null, true);
  },
}).single('file');

/**
 * Multer reports its own failures through the error argument, and its messages ("File too large")
 * are not what we want a user to read. Translate them into the app's error shape.
 */
const parseUpload = (
  req: Parameters<typeof uploadMiddleware>[0],
  res: Parameters<typeof uploadMiddleware>[1],
  next: Parameters<typeof uploadMiddleware>[2],
): void => {
  uploadMiddleware(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(AppError.badRequest(`That file is larger than the ${env.MAX_UPLOAD_MB} MB limit.`));
        return;
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        next(
          AppError.badRequest(
            'Send exactly one image in a field named "file" (multipart/form-data).',
          ),
        );
        return;
      }
      next(AppError.badRequest(`Upload rejected: ${err.message}`));
      return;
    }
    next(err);
  });
};

invoicesRouter.use(requireAuth);

invoicesRouter.post('/', parseUpload, asyncHandler(upload));
invoicesRouter.get('/', asyncHandler(list));

// Sub-resources before `/:id` is not required (the paths differ) but keeps the flow readable.
invoicesRouter.get('/:id/file', asyncHandler(getFile));
invoicesRouter.get('/:id/raw-text', asyncHandler(getRawText));
invoicesRouter.post('/:id/retry-ocr', asyncHandler(retry));
invoicesRouter.post('/:id/confirm', asyncHandler(confirm));
invoicesRouter.post('/:id/link', asyncHandler(link));

invoicesRouter.get('/:id', asyncHandler(getOne));
invoicesRouter.delete('/:id', asyncHandler(remove));
