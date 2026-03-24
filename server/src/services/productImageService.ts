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
  throw new HttpError(415, 'Unsupported Media Type. Allowed: jpg, png, webp.');
}

function publicUrlForPath(path: string): string {
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = supabaseAdmin.storage.from(config.productImagesBucket).getPublicUrl(path);
  return data.publicUrl;
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
  const result = await query<ProductRow>(
    `select id::text as id, farmer_wallet, image_url
     from public.products
     where id = $1::uuid
     limit 1`,
    [productId],
  );
  return result.rows[0] ?? null;
}

async function assertProductOwnership(productId: string, walletAddress: string): Promise<ProductRow> {
  const product = await getProduct(productId);
  if (!product) {
    throw new HttpError(404, 'Product not found.');
  }
  if (product.farmer_wallet.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new HttpError(403, 'Forbidden: you do not own this product.');
  }
  return product;
}

async function renderThumbnail(buffer: Buffer, size: 400 | 800): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize(size, size, { fit: 'cover' })
    .toFormat('webp', { quality: 82 })
    .toBuffer();
}

async function uploadVariant(path: string, body: Buffer, contentType: string): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.storage.from(config.productImagesBucket).upload(path, body, {
    contentType,
    upsert: true,
    cacheControl: '3600',
  });
  if (error) {
    throw new HttpError(500, `Storage upload failed: ${error.message}`);
  }
}

async function removeIfExists(path: string): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.storage.from(config.productImagesBucket).remove([path]);
  if (error) {
    throw new HttpError(500, `Storage delete failed: ${error.message}`);
  }
}

export async function uploadProductImage(params: {
  productId: string;
  walletAddress: string;
  fileBuffer: Buffer;
  mimeType: string;
}): Promise<{ imageUrl: string }> {
  const { productId, walletAddress, fileBuffer, mimeType } = params;
  const product = await assertProductOwnership(productId, walletAddress);
  const ext = mimeTypeToExt(mimeType);
  const farmerWallet = walletAddress.toLowerCase();
  const basePath = `${farmerWallet}/${productId}`;

  const originalPath = `${basePath}/original-${randomUUID()}.${ext}`;
  const thumb400Path = `${basePath}/thumbnail_400x400.webp`;
  const thumb800Path = `${basePath}/thumbnail_800x800.webp`;
  const uploadedPaths: UploadedPaths = { originalPath, thumb400Path, thumb800Path };

  // Delete existing paths under this product folder so stale variants are not left behind.
  const oldPrefix = basePath;
  const supabaseAdmin = getSupabaseAdmin();
  const { data: existingFiles, error: listError } = await supabaseAdmin.storage
    .from(config.productImagesBucket)
    .list(oldPrefix, { limit: 100 });
  if (listError) {
    throw new HttpError(500, `Storage list failed: ${listError.message}`);
  }
  if (existingFiles.length > 0) {
    const existingPaths = existingFiles.map((item) => `${oldPrefix}/${item.name}`);
    const { error: removeExistingError } = await supabaseAdmin.storage
      .from(config.productImagesBucket)
      .remove(existingPaths);
    if (removeExistingError) {
      throw new HttpError(500, `Storage cleanup failed: ${removeExistingError.message}`);
    }
  }

  const [thumb400, thumb800] = await Promise.all([
    renderThumbnail(fileBuffer, 400),
    renderThumbnail(fileBuffer, 800),
  ]);

  await uploadVariant(uploadedPaths.originalPath, fileBuffer, mimeType);
  await uploadVariant(uploadedPaths.thumb400Path, thumb400, 'image/webp');
  await uploadVariant(uploadedPaths.thumb800Path, thumb800, 'image/webp');

  const nextImageUrl = publicUrlForPath(uploadedPaths.thumb800Path);

  try {
    await query(
      `update public.products
       set image_url = $1
       where id = $2::uuid`,
      [nextImageUrl, product.id],
    );
  } catch (error) {
    await supabaseAdmin.storage
      .from(config.productImagesBucket)
      .remove([uploadedPaths.originalPath, uploadedPaths.thumb400Path, uploadedPaths.thumb800Path]);
    throw error;
  }

  return { imageUrl: nextImageUrl };
}

export async function deleteProductImage(params: {
  productId: string;
  walletAddress: string;
}): Promise<void> {
  const { productId, walletAddress } = params;
  const product = await assertProductOwnership(productId, walletAddress);
  const farmerWallet = walletAddress.toLowerCase();
  const prefix = `${farmerWallet}/${productId}`;
  const supabaseAdmin = getSupabaseAdmin();

  const { data, error } = await supabaseAdmin.storage.from(config.productImagesBucket).list(prefix, {
    limit: 100,
  });
  if (error) {
    throw new HttpError(500, `Storage list failed: ${error.message}`);
  }

  if (data.length > 0) {
    const paths = data.map((item) => `${prefix}/${item.name}`);
    const { error: removeError } = await supabaseAdmin.storage
      .from(config.productImagesBucket)
      .remove(paths);
    if (removeError) {
      throw new HttpError(500, `Storage delete failed: ${removeError.message}`);
    }
  } else if (product.image_url) {
    const pathFromUrl = parseProductPathFromUrl(product.image_url);
    if (pathFromUrl) {
      await removeIfExists(pathFromUrl);
    }
  }

  await query(
    `update public.products
     set image_url = $1
     where id = $2::uuid`,
    [config.productImagePlaceholderUrl, product.id],
  );
}
