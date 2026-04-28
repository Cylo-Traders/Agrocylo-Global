import multer from 'multer';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxUploadBytes = 5 * 1024 * 1024;

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 1 },
  fileFilter: (_req, _file, cb) => cb(null, true),
});

export function isUnsupportedMimeType(file?: Express.Multer.File): boolean {
  if (!file) return false;
  return !allowedMimeTypes.has(file.mimetype);
}
