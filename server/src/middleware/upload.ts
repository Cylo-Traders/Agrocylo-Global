import multer from 'multer';

export const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export class UploadError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Validates binary magic numbers to ensure the uploaded buffer matches allowed image formats
 * (JPEG, PNG, WebP) and is not a disguised or executable file.
 */
export function isValidImageBuffer(buffer: Buffer): { valid: boolean; detectedType?: 'jpg' | 'png' | 'webp' } {
  if (!buffer || buffer.length < 12) {
    return { valid: false };
  }

  // JPEG magic bytes: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, detectedType: 'jpg' };
  }

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, detectedType: 'png' };
  }

  // WebP magic bytes: RIFF .... WEBP
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { valid: true, detectedType: 'webp' };
  }

  return { valid: false };
}

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new UploadError(
          415,
          'UNSUPPORTED_MIME_TYPE',
          `Unsupported Media Type '${file.mimetype}'. Allowed types: image/jpeg, image/png, image/webp.`,
        ),
      );
    }
    cb(null, true);
  },
});

export const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new UploadError(
          415,
          'UNSUPPORTED_MIME_TYPE',
          `Unsupported Media Type '${file.mimetype}'. Allowed types: image/jpeg, image/png, image/webp.`,
        ),
      );
    }
    cb(null, true);
  },
});

export function isUnsupportedMimeType(file?: Express.Multer.File): boolean {
  if (!file) {
    return false;
  }
  return !ALLOWED_MIME_TYPES.has(file.mimetype);
}
