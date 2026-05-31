import express from 'express';
import multer from 'multer';
import { imageUpload, isUnsupportedMimeType } from '../middleware/upload.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { validateParams, jsonValidated } from '../middleware/validate.js';
import {
  CampaignImageParamSchema,
  CampaignImageUploadResponseSchema,
} from '../schemas/campaignImage.js';
import {
  HttpError,
  StorageError,
  uploadCampaignImage,
  deleteCampaignImage,
} from '../services/campaignImageService.js';

const router = express.Router();

router.post(
  '/campaigns/:campaign_id/image',
  requireWallet,
  validateParams(CampaignImageParamSchema),
  imageUpload.single('image'),
  async (req: WalletRequest, res, next) => {
    try {
      const campaignId = req.params['campaign_id'];
      const walletAddress = req.walletAddress;
      const image = req.file;

      if (!walletAddress) throw new HttpError(401, 'Unauthorized.');
      if (!image) {
        throw new HttpError(400, 'Missing or unsupported image. Must be a jpg, png, or webp file uploaded as field "image".');
      }
      if (isUnsupportedMimeType(image)) {
        throw new HttpError(415, 'Unsupported Media Type. Allowed: jpg, png, webp.');
      }

      const result = await uploadCampaignImage({
        campaignId,
        walletAddress,
        fileBuffer: image.buffer,
        mimeType: image.mimetype,
      });

      jsonValidated(res, CampaignImageUploadResponseSchema, 200, {
        image_url: result.imageUrl,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  '/campaigns/:campaign_id/image',
  requireWallet,
  validateParams(CampaignImageParamSchema),
  async (req: WalletRequest, res, next) => {
    try {
      const campaignId = req.params['campaign_id'];
      const walletAddress = req.walletAddress;

      if (!walletAddress) throw new HttpError(401, 'Unauthorized.');

      await deleteCampaignImage({ campaignId, walletAddress });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export function campaignImageErrorHandler(
  err: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ message: 'Payload Too Large. Max image size is 5MB.' });
    return;
  }
  if (err instanceof StorageError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  next(err);
}

export default router;
