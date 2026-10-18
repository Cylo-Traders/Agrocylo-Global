import express from 'express';
import multer from 'multer';
import { imageUpload, isUnsupportedMimeType, UploadError } from '../middleware/upload.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { uploadRateLimiter } from '../middleware/rateLimiter.js';
import { HttpError, deleteProductImage, uploadProductImage } from '../services/productImageService.js';
import { ApiError, sendProblem } from '../http/errors.js';
import logger from '../config/logger.js';

const router = express.Router();

// Auth runs before multer so the JWT is validated before any file data is
// processed. This prevents multipart parsing from consuming the request body
// before requireWallet can read the Authorization header (#1182).
router.post(
  '/products/:product_id/image',
  uploadRateLimiter,
  requireWallet,
  imageUpload.single('image'),
  async (req: WalletRequest, res, next) => {
    try {
      const productId = req.params['product_id'];
      const walletAddress = req.walletAddress;
      const image = req.file;

      logger.info('[productImageRoutes] POST /products/:product_id/image', {
        productId,
        walletAddress: walletAddress ?? null,
        hasAuthHeader: Boolean(req.header('Authorization')),
        contentType: req.header('Content-Type') ?? null,
        hasFile: Boolean(image),
      });

      if (!productId) {
        throw new HttpError(400, 'Missing product_id path parameter.', 'MISSING_PRODUCT_ID');
      }
      if (!walletAddress) {
        throw new HttpError(401, 'Unauthorized: Wallet session required.', 'UNAUTHORIZED');
      }
      if (!image) {
        throw new HttpError(
          400,
          "Missing image field. Please attach an image file under the 'image' multipart form field.",
          'MISSING_IMAGE_FIELD',
        );
      }
      if (isUnsupportedMimeType(image)) {
        throw new HttpError(
          415,
          `Unsupported Media Type '${image.mimetype}'. Allowed formats: image/jpeg, image/png, image/webp.`,
          'UNSUPPORTED_MIME_TYPE',
        );
      }

      const result = await uploadProductImage({
        productId,
        walletAddress,
        fileBuffer: image.buffer,
        mimeType: image.mimetype,
      });

      res.status(200).json({ image_url: result.imageUrl });
    } catch (error) {
      next(error);
    }
  },
);

router.delete('/products/:product_id/image', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    const productId = req.params['product_id'];
    const walletAddress = req.walletAddress;
    if (!productId) {
      throw new HttpError(400, 'Missing product_id path parameter.', 'MISSING_PRODUCT_ID');
    }
    if (!walletAddress) {
      throw new HttpError(401, 'Unauthorized: Wallet session required.', 'UNAUTHORIZED');
    }

    await deleteProductImage({ productId, walletAddress });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export function productImageErrorHandler(
  err: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      sendProblem(
        res,
        req,
        new ApiError(
          413,
          'Payload Too Large',
          'Payload Too Large. Maximum image size is 5MB.',
          'https://cylos.io/errors/payload-too-large',
          'LIMIT_FILE_SIZE',
        ),
      );
      return;
    }

    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      sendProblem(
        res,
        req,
        new ApiError(
          400,
          'Bad Request',
          `Upload error (${err.code}): Only a single image may be uploaded under field 'image'.`,
          'https://cylos.io/errors/bad-request',
          err.code,
        ),
      );
      return;
    }

    sendProblem(
      res,
      req,
      new ApiError(
        400,
        'Bad Request',
        `File upload error: ${err.message}`,
        'https://cylos.io/errors/bad-request',
        err.code,
      ),
    );
    return;
  }

  if (err instanceof UploadError) {
    sendProblem(
      res,
      req,
      new ApiError(
        err.status,
        err.status === 415 ? 'Unsupported Media Type' : 'Bad Request',
        err.message,
        `https://cylos.io/errors/${err.code.toLowerCase().replace(/_/g, '-')}`,
        err.code,
      ),
    );
    return;
  }

  if (err instanceof ApiError) {
    sendProblem(res, req, err);
    return;
  }

  next(err);
}

export default router;
