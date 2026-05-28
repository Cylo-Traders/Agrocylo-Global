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

export class StorageError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function isTransientError(error: unknown): boolean {
  if (error instanceof StorageError && TRANSIENT_STATUS_CODES.has(error.status)) return true;
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt >= retries) throw error;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

function classifyStorageError(
  operation: string,
  error: { statusCode?: number; message?: string } | null,
): StorageError {
  if (!error) {
    return new StorageError(500, `Storage ${operation} failed with unknown error.`);
  }
  switch (error.statusCode) {
    case 401:
      return new StorageError(500, `Storage ${operation} failed: authentication error.`, error);
    case 403:
      return new StorageError(500, `Storage ${operation} failed: permission denied.`, error);
    case 404:
      return new StorageError(500, `Storage ${operation} failed: path not found.`, error);
    case 413:
      return new StorageError(413, `Storage ${operation} failed: file exceeds storage size limit.`, error);
    case 408:
    case 429:
    case 502:
    case 503:
    case 504:
      return new StorageError(error.statusCode, `Storage ${operation} temporarily unavailable.`, error);
    default:
      return new StorageError(500, `Storage ${operation} failed: ${error.message ?? 'Unknown error'}`, error);
  }
}

export async function validateImageContent(buffer: Buffer): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new HttpError(422, 'Could not determine image dimensions. The file may be corrupted.');
    }
    if (metadata.width < 200 || metadata.height < 200) {
      throw new HttpError(422, 'Image dimensions too small. Minimum 200x200 pixels required.');
    }
    if (metadata.width > 4096 || metadata.height > 4096) {
      throw new HttpError(422, 'Image dimensions too large. Maximum 4096x4096 pixels allowed.');
    }
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, 'Invalid image file. The uploaded file could not be processed as an image.');
  }
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
  await withRetry(async () => {
    const { error } = await supabaseAdmin.storage
      .from(config.campaignImagesBucket)
      .upload(storagePath, body, { contentType, upsert: true, cacheControl: '3600' });
    if (error) throw classifyStorageError('upload', error);
  });
}

async function clearExistingFiles(prefix: string): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error: listError } = await supabaseAdmin.storage
    .from(config.campaignImagesBucket)
    .list(prefix, { limit: 100 });
  if (listError) throw classifyStorageError('list', listError);
  if (data && data.length > 0) {
    const paths = data.map((item) => `${prefix}/${item.name}`);
    const { error: removeError } = await supabaseAdmin.storage
      .from(config.campaignImagesBucket)
      .remove(paths);
    if (removeError) throw classifyStorageError('cleanup', removeError);
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

  await validateImageContent(fileBuffer);

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
    const supabaseAdmin = getSupabaseAdmin();
    const rollbackPaths = [originalPath, thumb400Path, thumb800Path];
    const { error: removeError } = await supabaseAdmin.storage
      .from(config.campaignImagesBucket)
      .remove(rollbackPaths);
    if (removeError) {
      console.error(
        `Rollback failed to clean up storage files for campaign ${campaignId}: ${removeError.message}`,
      );
    }
    throw new HttpError(500, 'Failed to save image metadata. Upload rolled back.');
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

  if (error) throw classifyStorageError('list', error);

  if (data && data.length > 0) {
    const paths = data.map((item) => `${prefix}/${item.name}`);
    const { error: removeError } = await supabaseAdmin.storage
      .from(config.campaignImagesBucket)
      .remove(paths);
    if (removeError) throw classifyStorageError('delete', removeError);
  } else if (campaign.image_url) {
    const pathFromUrl = parsePathFromUrl(campaign.image_url);
    if (pathFromUrl) {
      const { error: removeError } = await supabaseAdmin.storage
        .from(config.campaignImagesBucket)
        .remove([pathFromUrl]);
      if (removeError) throw classifyStorageError('delete', removeError);
    }
  }

  await query(
    `update public.campaigns
     set image_url = $1
     where id = $2::uuid`,
    [config.campaignImagePlaceholderUrl, campaign.id],
  );
}
