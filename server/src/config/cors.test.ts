import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const JWT_SECRET = vi.hoisted(() => 'test-secret-at-least-32-chars-long!!');
vi.mock('./index.js', () => ({
  config: { jwtSecret: JWT_SECRET, allowedOrigins: ['https://app.agrocylo.global'] },
}));
vi.mock('../services/authService.js', () => ({ HANDOFF_AUDIENCE: 'agrocylo-sso-handoff' }));
vi.mock('./database.js', () => ({ prisma: {} }));

const { corsOptions } = await import('./cors.js');
const { createIdempotencyMiddleware } = await import('../middleware/idempotency.js');
const { requireWallet } = await import('../middleware/walletAuth.js');

const ORIGIN = 'https://app.agrocylo.global';

function makeApp() {
  const store = new Map<string, string>();
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
  };
  const app = express();
  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(createIdempotencyMiddleware(redis as never));
  let mutations = 0;
  app.post('/cart/checkout', requireWallet, (_req, res) => {
    mutations++;
    res.status(201).json({ checkout: mutations });
  });
  return app;
}

describe('CORS policy (#954)', () => {
  it('allowed-origin preflight permits Idempotency-Key, x-api-key and x-request-id', async () => {
    const res = await request(makeApp())
      .options('/cart/checkout')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,idempotency-key,x-api-key,x-request-id');
    expect(res.status).toBe(204);
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
    for (const h of ['authorization', 'idempotency-key', 'x-api-key', 'x-request-id']) {
      expect(allowed).toContain(h);
    }
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('disallowed origin is rejected', async () => {
    const res = await request(makeApp())
      .options('/cart/checkout')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('browser completes a protected idempotent write with a bearer token; retry replays', async () => {
    const app = makeApp();
    const token = jwt.sign({ walletAddress: 'GWALLETA' }, JWT_SECRET);
    const send = () =>
      request(app)
        .post('/cart/checkout')
        .set('Origin', ORIGIN)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k1')
        .send({ cartId: 'c1' });

    const first = await send();
    expect(first.status).toBe(201);
    expect(first.headers['access-control-allow-origin']).toBe(ORIGIN);
    await new Promise((r) => setTimeout(r, 10));
    const retry = await send();
    expect(retry.body).toEqual({ checkout: 1 });

    const anon = await request(app)
      .post('/cart/checkout')
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', 'k1')
      .send({ cartId: 'c1' });
    expect(anon.status).toBe(401);
  });
});
