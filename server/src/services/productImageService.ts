import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/database.js';
import { getSupabaseAdmin } from '../config/supabase.js';
import { config } from '../config/index.js';
import logger from '../config/logger.js';
import { ApiError } from '../http/errors.js';
import { isValidImageBuffer } from '../middleware/upload.js';

export class HttpError extends ApiError {
  constructor(status: number, message: string, code?: string) {
    const title =
      status === 400
        ? 'Bad Request'
        : status === 401
          ? 'Unauthorized'
          : status === 403
            ? 'Forbidden'
            : status === 404
              ? 'Not Found'
              : status === 413
                ? 'Payload Too Large'
                : status === 415
                  ? 'Unsupported Media Type'
                  : status === 503
                    ? 'Service Unavailable'
                    : 'Internal Server Error';
    super(
      status,
      title,
      message,
      `https://cylos.io/errors/${code ? code.toLowerCase().replace(/_/g, '-') : status}`,
      code,
    );
    this.name = 'HttpError';
  }
}

interface ProductRow {
  id: string;
  farmer_wallet: string;
  image_url: string | null;
}

interface UploadedPaths {
  originalPath: string;
  thumb400Path: string;
  thumb800Path: string;
}

function mimeTypeToExt(mimeType: string): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  throw new HttpError(415, 'Unsupported Media Type. Allowed formats: image/jpeg, image/png, image/webp.', 'UNSUPPORTED_MIME_TYPE');
}

/** Check if Supabase storage is configured with valid credentials */
export function isSupabaseStorageConfigured(): boolean {
  return Boolean(
    config.supabaseUrl &&
      config.supabaseServiceRoleKey &&
      config.supabaseServiceRoleKey.trim().length > 0 &&
      !config.supabaseServiceRoleKey.includes('YOUR_SUPABASE')
  );
}

function publicUrlForPath(storagePath: string): string {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data } = supabaseAdmin.storage.from(config.productImagesBucket).getPublicUrl(storagePath);
    return data.publicUrl;
  } catch (err) {
    logger.error('Failed to get public URL from Supabase storage', err);
    throw new HttpError(
      503,
      'Image storage service is currently unreachable. Please check storage configuration.',
      'STORAGE_UNAVAILABLE',
    );
  }
}

function parseProductPathFromUrl(imageUrl: string | null): string | null {
  if (!imageUrl) {
    return null;
  }
  const marker = `/storage/v1/object/public/${config.productImagesBucket}/`;
  const idx = imageUrl.indexOf(marker);
  if (idx === -1) {
    return null;
  }
  return imageUrl.slice(idx + marker.length);
}

async function getProduct(productId: string): Promise<ProductRow | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, farmerWallet: true, imageUrl: true },
  });
  if (!product) return null;
  return {
    id: product.id,
    farmer_wallet: product.farmerWallet,
    image_url: product.imageUrl,
  };
}

async function assertProductOwnership(
  productId: string,
  walletAddress: string
): Promise<ProductRow> {
  const product = await getProduct(productId);
  if (!product) {
    throw new HttpError(404, `Product not found: ${productId}`, 'PRODUCT_NOT_FOUND');
  }
  if (product.farmer_wallet.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new HttpError(403, 'Forbidden: you do not have permission to manage this product image.', 'FORBIDDEN');
  }
  return product;
}

async function renderThumbnail(buffer: Buffer, size: 400 | 800): Promise<Buffer> {
  try {
    return await sharp(buffer)
      .rotate()
      .resize(size, size, { fit: 'cover' })
      .toFormat('webp', { quality: 82 })
      .toBuffer();
  } catch (err) {
    logger.error('Sharp thumbnail rendering failed', err);
    throw new HttpError(
      400,
      'Failed to process image buffer. Ensure the file is a valid, uncorrupted image.',
      'IMAGE_PROCESSING_FAILED',
    );
  }
}

// Local filesystem fallback storage directory for development
const LOCAL_UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'product-images');

async function saveToLocalDisk(storagePath: string, body: Buffer): Promise<string> {
  const fullPath = path.join(LOCAL_UPLOADS_DIR, storagePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, body);
  return `/uploads/product-images/${storagePath.replace(/\\/g, '/')}`;
}

async function uploadVariant(storagePath: string, body: Buffer, contentType: string): Promise<string> {
  if (isSupabaseStorageConfigured()) {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin.storage
        .from(config.productImagesBucket)
        .upload(storagePath, body, {
          contentType,
          upsert: true,
          cacheControl: '3600',
        });
      if (error) {
        logger.error('Supabase uploadVariant error', error);
        throw new HttpError(
          503,
          `Image storage upload failed: ${error.message}. Please check bucket '${config.productImagesBucket}'.`,
          'STORAGE_UNAVAILABLE',
        );
      }
      return publicUrlForPath(storagePath);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      logger.error('Supabase storage connection failed', err);
      throw new HttpError(
        503,
        `Image storage service unavailable: ${err instanceof Error ? err.message : 'connection failure'}.`,
        'STORAGE_UNAVAILABLE',
      );
    }
  }

  // Development mode local disk storage fallback
  if (config.nodeEnv !== 'production') {
    logger.info(`[Dev Storage] Saving product image variant to local disk: ${storagePath}`);
    return await saveToLocalDisk(storagePath, body);
  }

  throw new HttpError(
    503,
    'Image storage service is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    'STORAGE_NOT_CONFIGURED',
  );
}

async function removeIfExists(storagePath: string): Promise<void> {
  if (isSupabaseStorageConfigured()) {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { error } = await supabaseAdmin.storage.from(config.productImagesBucket).remove([storagePath]);
      if (error) {
        logger.warn('Storage delete warning', { message: error.message });
      }
    } catch (err) {
      logger.warn('Storage delete error', { error: err });
    }
    return;
  }

  // Local disk delete
  if (config.nodeEnv !== 'production') {
    const fullPath = path.join(LOCAL_UPLOADS_DIR, storagePath);
    await fs.promises.unlink(fullPath).catch(() => undefined);
  }
}

export async function uploadProductImage(params: {
  productId: string;
  walletAddress: string;
  fileBuffer: Buffer;
  mimeType: string;
}): Promise<{ imageUrl: string }> {
  const { productId, walletAddress, fileBuffer, mimeType } = params;

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new HttpError(400, 'Empty file buffer received.', 'EMPTY_FILE');
  }

  // Verify binary magic numbers to prevent disguised/malicious files
  const magicCheck = isValidImageBuffer(fileBuffer);
  if (!magicCheck.valid) {
    throw new HttpError(
      415,
      'Invalid or corrupted image file format. Allowed formats: JPEG, PNG, WebP.',
      'INVALID_IMAGE_BINARY',
    );
  }

  const product = await assertProductOwnership(productId, walletAddress);
  const ext = mimeTypeToExt(mimeType);
  const farmerWallet = walletAddress.toLowerCase();
  const basePath = `${farmerWallet}/${productId}`;

  const originalPath = `${basePath}/original-${randomUUID()}.${ext}`;
  const version = randomUUID();
  const thumb400Path = `${basePath}/thumbnail_400x400-${version}.webp`;
  const thumb800Path = `${basePath}/thumbnail_800x800-${version}.webp`;
  const uploadedPaths: UploadedPaths = { originalPath, thumb400Path, thumb800Path };

  // Render thumbnails using sharp
  const [thumb400, thumb800] = await Promise.all([
    renderThumbnail(fileBuffer, 400),
    renderThumbnail(fileBuffer, 800),
  ]);

  try {
    await uploadVariant(uploadedPaths.originalPath, fileBuffer, mimeType);
    await uploadVariant(uploadedPaths.thumb400Path, thumb400, 'image/webp');
    const nextImageUrl = await uploadVariant(uploadedPaths.thumb800Path, thumb800, 'image/webp');

    await prisma.product.update({
      where: { id: product.id },
      data: { imageUrl: nextImageUrl },
    });

    return { imageUrl: nextImageUrl };
  } catch (error) {
    // Attempt rollback of any uploaded variants
    await Promise.allSettled([
      removeIfExists(uploadedPaths.originalPath),
      removeIfExists(uploadedPaths.thumb400Path),
      removeIfExists(uploadedPaths.thumb800Path),
    ]);
    throw error;
  }
}

export async function deleteProductImage(params: {
  productId: string;
  walletAddress: string;
}): Promise<void> {
  const { productId, walletAddress } = params;
  const product = await assertProductOwnership(productId, walletAddress);
  const farmerWallet = walletAddress.toLowerCase();
  const prefix = `${farmerWallet}/${productId}`;

  if (isSupabaseStorageConfigured()) {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin.storage
        .from(config.productImagesBucket)
        .list(prefix, { limit: 100 });

      if (!error && data && data.length > 0) {
        const paths = data.map((item) => `${prefix}/${item.name}`);
        await supabaseAdmin.storage.from(config.productImagesBucket).remove(paths);
      } else if (product.image_url) {
        const pathFromUrl = parseProductPathFromUrl(product.image_url);
        if (pathFromUrl) {
          await removeIfExists(pathFromUrl);
        }
      }
    } catch (err) {
      logger.warn('Failed cleaning up remote images on delete', err);
    }
  } else if (config.nodeEnv !== 'production') {
    const localDir = path.join(LOCAL_UPLOADS_DIR, farmerWallet, productId);
    await fs.promises.rm(localDir, { recursive: true, force: true }).catch(() => undefined);
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { imageUrl: config.productImagePlaceholderUrl },
  });
}
