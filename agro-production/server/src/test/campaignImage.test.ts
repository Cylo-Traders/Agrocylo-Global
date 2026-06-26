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

const {
  mockStorageFrom,
  mockCampaignFindUnique,
  mockCampaignUpdate,
  mockVerifySession,
} = vi.hoisted(() => ({
  mockStorageFrom: {
    upload: vi.fn().mockResolvedValue({ error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://supabase.co/storage/v1/object/public/campaign-images/farmer/campaign/thumbnail_800x800.webp' } })),
  },
  mockCampaignFindUnique: vi.fn(),
  mockCampaignUpdate: vi.fn(),
  mockVerifySession: vi.fn().mockResolvedValue({ walletAddress: '', sessionToken: 'test-token' }),
}));

vi.mock('../services/walletAuthService.js', () => ({
  verifySession: mockVerifySession,
}));

vi.mock('../config/supabase.js', () => {
  let cached: ReturnType<ReturnType<typeof vi.fn>> | null = null;
  return {
    getSupabaseAdmin: vi.fn(() => {
      if (!cached) {
        cached = {
          storage: {
            from: vi.fn(() => mockStorageFrom),
          },
        };
      }
      return cached;
    }),
  };
});

vi.mock('../db/client.js', () => ({
  prisma: {
    campaign: {
      findUnique: mockCampaignFindUnique,
      update: mockCampaignUpdate,
    },
  },
}));

const SESSION_TOKEN = 'test-session-token';

import app from '../app.js';
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
    (sharp as unknown as ReturnType<typeof vi.fn>)().metadata.mockResolvedValue({ width: 800, height: 600 });
    (sharp as unknown as ReturnType<typeof vi.fn>)().toBuffer.mockResolvedValue(Buffer.from('fake-thumbnail'));
    mockStorageFrom.upload.mockResolvedValue({ error: null });
    mockStorageFrom.list.mockResolvedValue({ data: [], error: null });
    mockStorageFrom.remove.mockResolvedValue({ error: null });
    mockStorageFrom.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://supabase.co/storage/v1/object/public/campaign-images/farmer/campaign/thumbnail_800x800.webp' } });
    (getSupabaseAdmin().storage.from as ReturnType<typeof vi.fn>).mockReturnValue(mockStorageFrom);
  });

  describe('POST /campaigns/:campaign_id/image', () => {
    beforeEach(() => {
      mockVerifySession.mockResolvedValue({
        walletAddress: WALLET_ADDRESS,
        sessionToken: SESSION_TOKEN,
      });
    });

    it('should upload an image successfully', async () => {
      mockCampaignFindUnique.mockResolvedValue({
        id: VALID_UUID,
        farmerAddress: WALLET_ADDRESS.toLowerCase(),
        imageUrl: null,
      });
      mockCampaignUpdate.mockResolvedValue({});

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('Authorization', `Bearer ${SESSION_TOKEN}`)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('image_url');
      expect(res.body.image_url).toContain('thumbnail_800x800.webp');
    });

    it('should return 401 if no auth header', async () => {
      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(401);
    });

    it('should return 400 if no image file', async () => {
      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('Authorization', `Bearer ${SESSION_TOKEN}`);

      expect(res.status).toBe(400);
    });

    it('should return 400 for unsupported file type (rejected by multer)', async () => {
      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('Authorization', `Bearer ${SESSION_TOKEN}`)
        .attach('image', fakeImageBuffer(), 'test.gif');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Missing or unsupported');
    });

    it('should return 404 if campaign not found', async () => {
      mockCampaignFindUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('Authorization', `Bearer ${SESSION_TOKEN}`)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(404);
    });

    it('should return 403 if wallet does not own campaign', async () => {
      mockCampaignFindUnique.mockResolvedValue({
        id: VALID_UUID,
        farmerAddress: 'GOTHERWALLET00000000000000000000000000000000000000000',
        imageUrl: null,
      });

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('Authorization', `Bearer ${SESSION_TOKEN}`)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(403);
    });

    it('should return 422 if image dimensions are too small', async () => {
      const sharpModule = await import('sharp');
      const mockSharp = sharpModule.default as ReturnType<typeof vi.fn>;
      const mockInstance = mockSharp();
      mockInstance.metadata.mockResolvedValue({ width: 50, height: 50 });

      mockCampaignFindUnique.mockResolvedValue({
        id: VALID_UUID,
        farmerAddress: WALLET_ADDRESS.toLowerCase(),
        imageUrl: null,
      });

      const res = await request(app)
        .post(`/campaigns/${VALID_UUID}/image`)
        .set('Authorization', `Bearer ${SESSION_TOKEN}`)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('too small');
    });

    it('should return 500 if database update fails and roll back storage', async () => {
      mockCampaignFindUnique.mockResolvedValue({
        id: VALID_UUID,
        farmerAddress: WALLET_ADDRESS.toLowerCase(),
        imageUrl: null,
      });
      mockCampaignUpdate.mockRejectedValue(new Error('DB error'));

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
        .set('Authorization', `Bearer ${SESSION_TOKEN}`)
        .attach('image', fakeImageBuffer(), 'test.jpg');

      expect(res.status).toBe(500);
      expect(storageRemove).toHaveBeenCalled();
    });
  });

  describe('DELETE /campaigns/:campaign_id/image', () => {
    beforeEach(() => {
      mockVerifySession.mockResolvedValue({
        walletAddress: WALLET_ADDRESS,
        sessionToken: SESSION_TOKEN,
      });
    });

    it('should delete campaign image successfully', async () => {
      mockCampaignFindUnique.mockResolvedValue({
        id: VALID_UUID,
        farmerAddress: WALLET_ADDRESS.toLowerCase(),
        imageUrl: null,
      });
      mockCampaignUpdate.mockResolvedValue({});

      const res = await request(app)
        .delete(`/campaigns/${VALID_UUID}/image`)
        .set('Authorization', `Bearer ${SESSION_TOKEN}`);

      expect(res.status).toBe(204);
    });

    it('should return 401 if no auth header', async () => {
      const res = await request(app)
        .delete(`/campaigns/${VALID_UUID}/image`);

      expect(res.status).toBe(401);
    });

    it('should return 404 if campaign not found', async () => {
      mockCampaignFindUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete(`/campaigns/${VALID_UUID}/image`)
        .set('Authorization', `Bearer ${SESSION_TOKEN}`);

      expect(res.status).toBe(404);
    });
  });
});
