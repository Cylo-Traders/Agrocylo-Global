import { getSupabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../http/errors.js';
import crypto from 'crypto';
import logger from '../config/logger.js';
import sharp from 'sharp';

export class EvidenceStorageService {
  private static BUCKET_NAME = 'dispute-evidence';

  /**
   * Uploads a file to Supabase Storage and returns its path
   * @param file The file object (from multer)
   * @param orderIdOnChain The related order ID
   * @returns The path of the stored evidence
   */
  static async uploadEvidence(file: Express.Multer.File, _orderIdOnChain: string): Promise<string> {
    const supabase = getSupabaseAdmin();

    if (!file) {
      throw new ApiError(400, 'Bad Request', 'No file provided');
    }

    const bytes = file.buffer;
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng =
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isWebp =
      bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!isJpeg && !isPng && !isWebp) {
      throw new ApiError(
        415,
        'Unsupported Media Type',
        'Evidence must be a valid JPEG, PNG, or WebP image'
      );
    }

    let safeBuffer: Buffer;
    try {
      // Decoding and re-encoding verifies the actual bytes and strips active/image metadata.
      safeBuffer = await sharp(file.buffer, { failOn: 'error' }).png().toBuffer();
    } catch {
      throw new ApiError(
        415,
        'Unsupported Media Type',
        'Evidence must be a valid JPEG, PNG, or WebP image'
      );
    }

    const metadata = await sharp(safeBuffer).metadata();
    if (metadata.format !== 'png') {
      throw new ApiError(415, 'Unsupported Media Type', 'Evidence must be a valid image');
    }

    // The storage key contains no order ID or original filename supplied by the caller.
    const fileHash = crypto.createHash('sha256').update(safeBuffer).digest('hex').substring(0, 16);
    const fileName = `${crypto.randomUUID()}-${fileHash}.bin`;

    const { data, error } = await supabase.storage
      .from(this.BUCKET_NAME)
      .upload(fileName, safeBuffer, {
        // Force download behavior if the object is exposed through a storage URL.
        contentType: 'application/octet-stream',
        upsert: false,
      });

    if (error) {
      logger.error('Supabase storage upload failed', { error });
      throw new ApiError(500, 'Internal Server Error', 'Failed to upload evidence to storage');
    }

    return data.path;
  }
}
