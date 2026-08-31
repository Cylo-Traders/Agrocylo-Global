import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../config/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    storage: { from: () => ({ upload: storage.upload }) },
  }),
}));
vi.mock('../config/logger.js', () => ({ default: { error: vi.fn() } }));

import { EvidenceStorageService } from './evidenceStorageService.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function file(buffer: Buffer, originalname: string, mimetype = 'image/png') {
  return { buffer, originalname, mimetype } as Express.Multer.File;
}

describe('EvidenceStorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.upload.mockResolvedValue({ data: { path: 'stored' }, error: null });
  });

  it('rejects HTML bytes even when the client claims image/png', async () => {
    await expect(
      EvidenceStorageService.uploadEvidence(
        file(Buffer.from('<html>bad</html>'), 'fake.png'),
        'order-1'
      )
    ).rejects.toMatchObject({ status: 415 });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('does not include caller-controlled names or IDs in the storage key', async () => {
    await EvidenceStorageService.uploadEvidence(file(png, '../../payload.png'), '../../order');
    const [key, , options] = storage.upload.mock.calls[0] as [
      string,
      Buffer,
      { contentType: string },
    ];
    expect(key).not.toContain('..');
    expect(key).not.toContain('payload');
    expect(key).not.toContain('order');
    expect(options.contentType).toBe('application/octet-stream');
  });
});
