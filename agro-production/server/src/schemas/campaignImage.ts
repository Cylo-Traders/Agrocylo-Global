import { z } from 'zod';
import { uuidParam } from './common.js';

export const CampaignImageParamSchema = z.object({
  campaign_id: uuidParam,
});

export const CampaignImageUploadResponseSchema = z.object({
  image_url: z.string().url(),
});

export type CampaignImageParam = z.infer<typeof CampaignImageParamSchema>;
