import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../app.js';

const DOCUMENTED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost',
  'http://127.0.0.1',
];

describe('agro-production CORS policy (#1422)', () => {
  it.each(DOCUMENTED_ORIGINS)(
    'preflight succeeds from documented origin %s with Authorization, Content-Type, x-wallet-address and x-idempotency-key',
    async (origin) => {
      const res = await request(app)
        .options('/api/v1/orders')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'authorization,content-type,x-wallet-address,x-idempotency-key,idempotency-key',
        );

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      const allowedHeaders = String(
        res.headers['access-control-allow-headers'],
      ).toLowerCase();
      for (const h of [
        'authorization',
        'content-type',
        'x-wallet-address',
        'x-idempotency-key',
        'idempotency-key',
      ]) {
        expect(allowedHeaders).toContain(h);
      }
    },
  );

  it('rejects disallowed external origins on preflight', async () => {
    const res = await request(app)
      .options('/api/v1/orders')
      .set('Origin', 'https://untrusted-attacker.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
