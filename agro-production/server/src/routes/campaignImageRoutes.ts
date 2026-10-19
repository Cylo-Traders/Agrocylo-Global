import express from 'express';
import { imageUpload, isUnsupportedMimeType } from '../middleware/upload.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { validateParams, jsonValidated } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import {
  CampaignImageParamSchema,
  CampaignImageUploadResponseSchema,
} from '../schemas/campaignImage.js';
import {
  uploadCampaignImage,
  deleteCampaignImage,
} from '../services/campaignImageService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = express.Router();

router.post(
  '/campaigns/:campaign_id/image',
  requireWallet,
  validateParams(CampaignImageParamSchema),
  imageUpload.single('image'),
  asyncHandler(async (req: WalletRequest, res) => {
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
  }),
);

router.delete(
  '/campaigns/:campaign_id/image',
  requireWallet,
  validateParams(CampaignImageParamSchema),
  asyncHandler(async (req: WalletRequest, res) => {
    const campaignId = req.params['campaign_id'];
    const walletAddress = req.walletAddress;

    if (!walletAddress) throw new HttpError(401, 'Unauthorized.');

    await deleteCampaignImage({ campaignId, walletAddress });
    res.status(204).send();
  }),
);

export default router;
