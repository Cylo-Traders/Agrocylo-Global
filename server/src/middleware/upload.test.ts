import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  evidenceUpload,
  imageUpload,
  isValidImageBuffer,
  isUnsupportedMimeType,
  UploadError,
  MAX_UPLOAD_BYTES,
} from './upload.js';

describe('upload middleware', () => {
  describe('isValidImageBuffer', () => {
    it('detects valid JPEG magic bytes', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      const result = isValidImageBuffer(jpegBuffer);
      expect(result.valid).toBe(true);
      expect(result.detectedType).toBe('jpg');
    });

    it('detects valid PNG magic bytes', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      const result = isValidImageBuffer(pngBuffer);
      expect(result.valid).toBe(true);
      expect(result.detectedType).toBe('png');
    });

    it('detects valid WebP magic bytes', () => {
      const webpBuffer = Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.alloc(4),
        Buffer.from('WEBP', 'ascii'),
      ]);
      const result = isValidImageBuffer(webpBuffer);
      expect(result.valid).toBe(true);
      expect(result.detectedType).toBe('webp');
    });

    it('rejects invalid or non-image binary buffers', () => {
      const textBuffer = Buffer.from('<!DOCTYPE html><html><body>malicious</body></html>');
      expect(isValidImageBuffer(textBuffer).valid).toBe(false);

      const emptyBuffer = Buffer.alloc(0);
      expect(isValidImageBuffer(emptyBuffer).valid).toBe(false);

      const shortBuffer = Buffer.from([0xff, 0xd8]);
      expect(isValidImageBuffer(shortBuffer).valid).toBe(false);
    });
  });

  describe('isUnsupportedMimeType', () => {
    it('identifies allowed mime types', () => {
      expect(isUnsupportedMimeType({ mimetype: 'image/jpeg' } as Express.Multer.File)).toBe(false);
      expect(isUnsupportedMimeType({ mimetype: 'image/png' } as Express.Multer.File)).toBe(false);
      expect(isUnsupportedMimeType({ mimetype: 'image/webp' } as Express.Multer.File)).toBe(false);
    });

    it('flags unsupported mime types', () => {
      expect(isUnsupportedMimeType({ mimetype: 'image/gif' } as Express.Multer.File)).toBe(true);
      expect(isUnsupportedMimeType({ mimetype: 'application/pdf' } as Express.Multer.File)).toBe(true);
      expect(isUnsupportedMimeType({ mimetype: 'text/html' } as Express.Multer.File)).toBe(true);
    });
  });

  describe('evidenceUpload', () => {
    it("rejects evidence larger than 5MB with multer's size error", async () => {
      const app = express();
      app.post('/evidence', evidenceUpload.single('file'), (_req, res) => res.sendStatus(204));
      app.use(
        (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
          const code = typeof err === 'object' && err && 'code' in err ? err.code : undefined;
          res.sendStatus(code === 'LIMIT_FILE_SIZE' ? 413 : 500);
        }
      );

      const response = await request(app)
        .post('/evidence')
        .attach('file', Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'large.png');
      expect(response.status).toBe(413);
    });
  });

  describe('imageUpload', () => {
    function createTestApp() {
      const app = express();
      app.post('/upload', imageUpload.single('image'), (req, res) => {
        res.status(200).json({ filename: req.file?.originalname, size: req.file?.size });
      });
      app.use(
        (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
          if (err instanceof UploadError) {
            res.status(err.status).json({ error: err.message, code: err.code });
            return;
          }
          const code = typeof err === 'object' && err && 'code' in err ? err.code : undefined;
          if (code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: 'Payload Too Large', code });
            return;
          }
          if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') {
            res.status(400).json({ error: 'Unexpected file count or field', code });
            return;
          }
          res.status(500).json({ error: 'Internal Server Error' });
        }
      );
      return app;
    }

    it('accepts valid JPEG file within size limit', async () => {
      const app = createTestApp();
      const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      const res = await request(app)
        .post('/upload')
        .attach('image', validJpeg, { filename: 'test.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(200);
      expect(res.body.filename).toBe('test.jpg');
    });

    it('rejects files exceeding 5MB with 413', async () => {
      const app = createTestApp();
      const largeBuffer = Buffer.alloc(MAX_UPLOAD_BYTES + 1024);
      const res = await request(app)
        .post('/upload')
        .attach('image', largeBuffer, { filename: 'huge.png', contentType: 'image/png' });
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('LIMIT_FILE_SIZE');
    });

    it('rejects unsupported MIME types with 415 and descriptive error', async () => {
      const app = createTestApp();
      const textBuffer = Buffer.from('hello world');
      const res = await request(app)
        .post('/upload')
        .attach('image', textBuffer, { filename: 'test.txt', contentType: 'text/plain' });
      expect(res.status).toBe(415);
      expect(res.body.code).toBe('UNSUPPORTED_MIME_TYPE');
      expect(res.body.error).toContain('Unsupported Media Type');
    });

    it('rejects unexpected field names with 400', async () => {
      const app = createTestApp();
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      const res = await request(app)
        .post('/upload')
        .attach('wrong_field', validPng, { filename: 'test.png', contentType: 'image/png' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('LIMIT_UNEXPECTED_FILE');
    });
  });
});
