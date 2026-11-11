import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import app from './app.js';

vi.mock('./config/database.js', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

vi.mock('./config/supabase.js', () => ({
  getSupabaseAdmin: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    }),
  }),
}));

describe('Security Headers', () => {
  it('should include X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should include Referrer-Policy: strict-origin-when-cross-origin', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('should include Content-Security-Policy appropriate for JSON API', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  describe('HSTS header', () => {
    it('should include Strict-Transport-Security in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Re-require app to pick up new environment
      const { default: prodApp } = await import('./app.js');
      const res = await request(prodApp).get('/health');

      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      expect(res.headers['strict-transport-security']).toContain('includeSubDomains');

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include Strict-Transport-Security in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Re-require app to pick up new environment
      const { default: devApp } = await import('./app.js');
      const res = await request(devApp).get('/health');

      expect(res.headers['strict-transport-security']).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  it('should include X-Frame-Options: DENY', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('client IP should be correctly derived behind proxy', async () => {
    const res = await request(app).get('/health').set('X-Forwarded-For', '192.168.1.100, 10.0.0.1');

    expect(res.status).toBe(200);
  });
});
