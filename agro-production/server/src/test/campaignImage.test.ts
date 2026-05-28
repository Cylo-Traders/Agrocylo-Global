import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('sharp', () => {
  const mockSharpInstance = {
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    toFormat: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-thumbnail')),
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  };
  const sharp = vi.fn(() => mockSharpInstance);
  return { default: sharp };
});

const mockStorageFrom = {
  upload: vi.fn().mockResolvedValue({ error: null }),
  list: vi.fn().mockResolvedValue({ data: [], error: null }),
  remove: vi.fn().mockResolvedValue({ error: null }),
  getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://supabase.co/storage/v1/object/public/campaign-images/farmer/campaign/thumbnail_800x800.webp' } })),
};

vi.mock('../config/supabase.js', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    storage: {
      from: vi.fn(() => mockStorageFrom),
    },
  })),
}));

vi.mock('../config/database.js', () => ({
  query: vi.fn(),
}));

import app from '../index.js';
import { query } from '../config/database.js';
import { getSupabaseAdmin } from '../config/supabase.js';
import sharp from 'sharp';

const VALID_UUID = '00000000-0000-0000-0000-000000000001';
const WALLET_ADDRESS = 'GBP7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7XY7J7Y7X';

function fakeImageBuffer(): Buffer {
  return Buffer.from('fake-image-data');
}

describe('Campaign Image Upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /campaigns/:campaign_id/image', () => {
    it('should upload an image successfully', async () => {
      (query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: VALID_UUID, farmer_wallet: WALLET_ADDRESS.toLowerCase(), image_url: null }],
      });

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('image_url');
      expect(res.body.image_url).toContain('thumbnail_800x800.webp');
    });

    it('should return 401 if no wallet header', async () => {
      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(401);
    });

    it('should return 400 if no image file', async () => {
      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS);

      expect(res.status).toBe(400);
    });

    it('should return 400 for unsupported file type (rejected by multer)', async () => {
      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS)
        .attach('image', fakeImageBuffer(), 'test.gif');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Missing or unsupported');
    });

    it('should return 404 if campaign not found', async () => {
      (query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(404);
    });

    it('should return 403 if wallet does not own campaign', async () => {
      (query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: VALID_UUID, farmer_wallet: 'other_wallet', image_url: null }],
      });

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(403);
    });

    it('should return 422 if image dimensions are too small', async () => {
      const sharpModule = await import('sharp');
      const mockSharp = sharpModule.default as ReturnType<typeof vi.fn>;
      const mockInstance = mockSharp();
      mockInstance.metadata.mockResolvedValue({ width: 50, height: 50 });

      (query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: VALID_UUID, farmer_wallet: WALLET_ADDRESS.toLowerCase(), image_url: null }],
      });

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('too small');
    });

    it('should return 500 if database update fails and roll back storage', async () => {
      (query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          rows: [{ id: VALID_UUID, farmer_wallet: WALLET_ADDRESS.toLowerCase(), image_url: null }],
        })
        .mockRejectedValueOnce(new Error('DB error'));

      const storageRemove = vi.fn().mockResolvedValue({ error: null });
      const supabaseAdmin = getSupabaseAdmin();
      (supabaseAdmin.storage.from as ReturnType<typeof vi.fn>).mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
        remove: storageRemove,
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://supabase.co/image.webp' } })),
      });

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(500);
      expect(storageRemove).toHaveBeenCalled();
    });
  });

  describe('DELETE /campaigns/:campaign_id/image', () => {
    it('should delete campaign image successfully', async () => {
      (query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: VALID_UUID, farmer_wallet: WALLET_ADDRESS.toLowerCase(), image_url: null }],
      });

      const res = await request(app)
        .delete(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS);

      expect(res.status).toBe(204);
    });

    it('should return 401 if no wallet header', async () => {
      const res = await request(app)
        .delete(`/campaigns/${VALID_UUID}/image`);

      expect(res.status).toBe(401);
    });

    it('should return 404 if campaign not found', async () => {
      (query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const res = await request(app)
        .delete(`/campaigns/${VALID_UUID}/image`)
        .set('x-wallet-address', WALLET_ADDRESS);

      expect(res.status).toBe(404);
    });
  });
});
