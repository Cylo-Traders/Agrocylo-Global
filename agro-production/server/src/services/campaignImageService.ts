import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { query } from '../config/database.js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { config } from '../config/index.js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface CampaignRow {
  id: string;
  farmer_wallet: string;
  image_url: string | null;
}

function mimeTypeToExt(mimeType: string): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  throw new HttpError(415, 'Unsupported Media Type. Allowed: jpg, png, webp.');
}

function publicUrlForPath(storagePath: string): string {
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = supabaseAdmin.storage
    .from(config.campaignImagesBucket)
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

function parsePathFromUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  const marker = `/storage/v1/object/public/${config.campaignImagesBucket}/`;
  const idx = imageUrl.indexOf(marker);
  if (idx === -1) return null;
  return imageUrl.slice(idx + marker.length);
}

async function getCampaign(campaignId: string): Promise<CampaignRow | null> {
  const result = await query<CampaignRow>(
    `select id::text as id, farmer_wallet, image_url
     from public.campaigns
     where id = $1::uuid
     limit 1`,
    [campaignId],
  );
  return result.rows[0] ?? null;
}

async function assertCampaignOwnership(
  campaignId: string,
  walletAddress: string,
): Promise<CampaignRow> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    throw new HttpError(404, 'Campaign not found.');
  }
  if (campaign.farmer_wallet.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new HttpError(403, 'Forbidden: you do not own this campaign.');
  }
  return campaign;
}

async function renderThumbnail(buffer: Buffer, size: 400 | 800): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize(size, size, { fit: 'cover' })
    .toFormat('webp', { quality: 82 })
    .toBuffer();
}

async function uploadVariant(
  storagePath: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.storage
    .from(config.campaignImagesBucket)
    .upload(storagePath, body, { contentType, upsert: true, cacheControl: '3600' });
  if (error) {
    throw new HttpError(500, `Storage upload failed: ${error.message}`);
  }
}

async function clearExistingFiles(prefix: string): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error: listError } = await supabaseAdmin.storage
    .from(config.campaignImagesBucket)
    .list(prefix, { limit: 100 });
  if (listError) {
    throw new HttpError(500, `Storage list failed: ${listError.message}`);
  }
  if (data && data.length > 0) {
    const paths = data.map((item) => `${prefix}/${item.name}`);
    const { error: removeError } = await supabaseAdmin.storage
      .from(config.campaignImagesBucket)
      .remove(paths);
    if (removeError) {
      throw new HttpError(500, `Storage cleanup failed: ${removeError.message}`);
    }
  }
}

/**
 * Upload an image for a campaign.
 *
 * Stores the original plus 400×400 and 800×800 WebP thumbnails in Supabase
 * Storage, then updates the campaigns table with the public URL of the
 * 800×800 thumbnail.
 *
 * Returns the public image URL.
 */
export async function uploadCampaignImage(params: {
  campaignId: string;
  walletAddress: string;
  fileBuffer: Buffer;
  mimeType: string;
}): Promise<{ imageUrl: string }> {
  const { campaignId, walletAddress, fileBuffer, mimeType } = params;

  const campaign = await assertCampaignOwnership(campaignId, walletAddress);
  const ext = mimeTypeToExt(mimeType);
  const farmerWallet = walletAddress.toLowerCase();
  const basePath = `${farmerWallet}/${campaignId}`;

  await clearExistingFiles(basePath);

  const originalPath = `${basePath}/original-${randomUUID()}.${ext}`;
  const thumb400Path = `${basePath}/thumbnail_400x400.webp`;
  const thumb800Path = `${basePath}/thumbnail_800x800.webp`;

  const [thumb400, thumb800] = await Promise.all([
    renderThumbnail(fileBuffer, 400),
    renderThumbnail(fileBuffer, 800),
  ]);

  await uploadVariant(originalPath, fileBuffer, mimeType);
  await uploadVariant(thumb400Path, thumb400, 'image/webp');
  await uploadVariant(thumb800Path, thumb800, 'image/webp');

  const imageUrl = publicUrlForPath(thumb800Path);

  try {
    await query(
      `update public.campaigns
       set image_url = $1
       where id = $2::uuid`,
      [imageUrl, campaign.id],
    );
  } catch (error) {
    // Roll back the uploaded files if the DB write fails.
    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin.storage
      .from(config.campaignImagesBucket)
      .remove([originalPath, thumb400Path, thumb800Path]);
    throw error;
  }

  return { imageUrl };
}

/**
 * Delete all images for a campaign and reset its image_url to the placeholder.
 */
export async function deleteCampaignImage(params: {
  campaignId: string;
  walletAddress: string;
}): Promise<void> {
  const { campaignId, walletAddress } = params;

  const campaign = await assertCampaignOwnership(campaignId, walletAddress);
  const farmerWallet = walletAddress.toLowerCase();
  const prefix = `${farmerWallet}/${campaignId}`;

  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.storage
    .from(config.campaignImagesBucket)
    .list(prefix, { limit: 100 });

  if (error) {
    throw new HttpError(500, `Storage list failed: ${error.message}`);
  }

  if (data && data.length > 0) {
    const paths = data.map((item) => `${prefix}/${item.name}`);
    const { error: removeError } = await supabaseAdmin.storage
      .from(config.campaignImagesBucket)
      .remove(paths);
    if (removeError) {
      throw new HttpError(500, `Storage delete failed: ${removeError.message}`);
    }
  } else if (campaign.image_url) {
    const pathFromUrl = parsePathFromUrl(campaign.image_url);
    if (pathFromUrl) {
      const { error: removeError } = await supabaseAdmin.storage
        .from(config.campaignImagesBucket)
        .remove([pathFromUrl]);
      if (removeError) {
        throw new HttpError(500, `Storage delete failed: ${removeError.message}`);
      }
    }
  }

  await query(
    `update public.campaigns
     set image_url = $1
     where id = $2::uuid`,
    [config.campaignImagePlaceholderUrl, campaign.id],
  );
}
