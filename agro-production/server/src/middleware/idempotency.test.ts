import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import {
  idempotencyCacheKey,
  replayCachedResponse,
  requireIdempotencyKey,
  setCachedResponse,
} from './idempotency.js';
import {
  closeIdempotencyStore,
  createMemoryIdempotencyStore,
} from './idempotencyStore.js';

const KEY = 'x-idempotency-key';
const WALLET_A = 'GA-WALLET-A';
const WALLET_B = 'GB-WALLET-B';

type WalletRequest = Request & { walletAddress?: string };

/** Narrows a supertest `any` body to the shape under test. */
const bodyOf = <T>(res: { body: unknown }): T => res.body as T;

/**
 * Minimal app: `requireWallet` is replaced by a header stand-in (the real one is
 * covered by walletAuth.test.ts) so these cases stay focused on the cache.
 */
function buildApp() {
  const app = express();
  const counters = { orders: 0, campaigns: 0 };

  app.use(express.json());
  app.use((req: Request, _res: Response, next) => {
    const wallet = req.header('x-wallet-address');
    if (wallet) (req as WalletRequest).walletAddress = wallet;
    next();
  });

  const create = async (
    req: Request,
    res: Response,
    kind: 'orders' | 'campaigns',
  ) => {
    if (await replayCachedResponse(req, res)) return;
    counters[kind] += 1;
    const wallet = (req as WalletRequest).walletAddress;
    const body =
      kind === 'orders'
        ? { id: `order-${counters.orders}`, buyerAddress: wallet }
        : { id: `campaign-${counters.campaigns}`, farmerAddress: wallet };
    await setCachedResponse(req, 201, body);
    res.status(201).json(body);
  };

  app.post('/api/v1/orders', requireIdempotencyKey, (req, res) => {
    void create(req, res, 'orders');
  });
  app.post('/api/v1/campaigns', requireIdempotencyKey, (req, res) => {
    void create(req, res, 'campaigns');
  });

  return { app, counters };
}

const post = (
  app: express.Express,
  path: string,
  wallet: string | undefined,
  key: string,
  body: object,
) => {
  const req = request(app).post(path).set(KEY, key);
  return (wallet ? req.set('x-wallet-address', wallet) : req).send(body);
};

const order = { campaignId: 'c1', amount: 10 };

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await closeIdempotencyStore();
});

describe('idempotency cache scoping', () => {
  it('replays the cached response for the same wallet and key', async () => {
    const { app, counters } = buildApp();

    const first = await post(app, '/api/v1/orders', WALLET_A, 'k1', order);
    const second = await post(app, '/api/v1/orders', WALLET_A, 'k1', order);

    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(counters.orders).toBe(1);
  });

  it("never returns another wallet's cached response (cross-tenant leak)", async () => {
    const { app, counters } = buildApp();

    const fromA = await post(app, '/api/v1/orders', WALLET_A, 'k2', order);
    const fromB = await post(app, '/api/v1/orders', WALLET_B, 'k2', order);

    expect(bodyOf<{ buyerAddress?: string }>(fromA).buyerAddress).toBe(
      WALLET_A,
    );
    expect(fromB.status).toBe(201);
    expect(bodyOf<{ buyerAddress?: string }>(fromB).buyerAddress).toBe(
      WALLET_B,
    );
    expect(bodyOf<{ id: string }>(fromB).id).not.toBe(
      bodyOf<{ id: string }>(fromA).id,
    );
    expect(counters.orders).toBe(2);
  });

  it('keeps the same key separate per route', async () => {
    const { app, counters } = buildApp();

    await post(app, '/api/v1/orders', WALLET_A, 'k3', order);
    const campaign = await post(app, '/api/v1/campaigns', WALLET_A, 'k3', {
      tokenAddress: 't1',
    });

    expect(campaign.status).toBe(201);
    expect(bodyOf<{ farmerAddress?: string }>(campaign).farmerAddress).toBe(
      WALLET_A,
    );
    expect(counters).toEqual({ orders: 1, campaigns: 1 });
  });

  it('returns 409 when the key is reused with a different body', async () => {
    const { app } = buildApp();

    await post(app, '/api/v1/orders', WALLET_A, 'k4', order);
    const conflict = await post(app, '/api/v1/orders', WALLET_A, 'k4', {
      campaignId: 'c1',
      amount: 99,
    });

    expect(conflict.status).toBe(409);
    expect(bodyOf<{ title?: string }>(conflict).title).toBe(
      'Idempotency Key Reused',
    );
  });

  it('builds keys that include route, wallet and header key', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/orders?x=1',
      idempotencyKey: 'abc',
      walletAddress: WALLET_A,
    } as unknown as Request;

    expect(idempotencyCacheKey(req)).toBe(
      `idem:v2:POST /api/v1/orders:${WALLET_A}:abc`,
    );
  });
});

describe('memory idempotency store', () => {
  const entry = { status: 201, body: { ok: true }, fingerprint: 'fp' };

  it('evicts expired entries without a follow-up request', async () => {
    vi.useFakeTimers();
    const store = createMemoryIdempotencyStore({ sweepIntervalMs: 1_000 });

    await store.set('k1', entry, 60);
    expect(store.size).toBe(1);

    vi.advanceTimersByTime(61_000);
    expect(store.size).toBe(0);
    expect(await store.get('k1')).toBeNull();

    await store.close();
  });

  it('stays bounded when keys are never repeated', async () => {
    const store = createMemoryIdempotencyStore({
      maxEntries: 3,
      sweepIntervalMs: 60_000,
    });

    for (let i = 0; i < 5; i += 1) await store.set(`k${i}`, entry, 60);

    expect(store.size).toBe(3);
    expect(await store.get('k0')).toBeNull();
    expect(await store.get('k4')).not.toBeNull();

    await store.close();
  });
});
