import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { evidenceUpload } from './upload.js';

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
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png');
    expect(response.status).toBe(413);
  });
});
