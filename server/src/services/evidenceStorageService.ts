import { getSupabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../http/errors.js';
import crypto from 'crypto';

export class EvidenceStorageService {
  private static BUCKET_NAME = 'dispute-evidence';

  /**
   * Uploads a file to Supabase Storage and returns its path
   * @param file The file object (from multer)
   * @param orderIdOnChain The related order ID
   * @returns The path of the stored evidence
   */
  static async uploadEvidence(file: any, orderIdOnChain: string): Promise<string> {
    const supabase = getSupabaseAdmin();

    if (!file) {
      throw new ApiError(400, 'Bad Request', 'No file provided');
    }

    // Generate a unique filename: [orderId]/[timestamp]-[hash]-[originalName]
    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex').substring(0, 8);
    const fileName = `${orderIdOnChain}/${Date.now()}-${fileHash}-${file.originalname}`;

    const { data, error } = await supabase.storage
      .from(this.BUCKET_NAME)
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('Supabase Storage Error:', error);
      throw new ApiError(500, 'Internal Server Error', 'Failed to upload evidence to storage');
    }

    return data.path;
  }
}
