import express from 'express';
import multer from 'multer';
import { imageUpload, isUnsupportedMimeType } from '../middleware/upload.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { HttpError, deleteProductImage, uploadProductImage } from '../services/productImageService.js';

const router = express.Router();

router.post(
  '/products/:product_id/image',
  requireWallet,
  imageUpload.single('image'),
  async (req: WalletRequest, res, next) => {
    try {
      const productId = req.params['product_id'];
      const walletAddress = req.walletAddress;
      const image = req.file;

      if (!productId) {
        throw new HttpError(400, 'Missing product_id path param.');
      }
      if (!walletAddress) {
        throw new HttpError(401, 'Unauthorized.');
      }
      if (!image) {
        throw new HttpError(400, 'Missing image field in multipart form-data.');
      }
      if (isUnsupportedMimeType(image)) {
        throw new HttpError(415, 'Unsupported Media Type. Allowed: jpg, png, webp.');
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
      throw new HttpError(400, 'Missing product_id path param.');
    }
    if (!walletAddress) {
      throw new HttpError(401, 'Unauthorized.');
    }

    await deleteProductImage({ productId, walletAddress });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export function productImageErrorHandler(
  err: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ message: 'Payload Too Large. Max image size is 5MB.' });
      return;
    }
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
    return;
  }

  next(err);
}

export default router;
