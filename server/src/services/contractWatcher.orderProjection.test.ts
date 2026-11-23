import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { db, txClient, getEvents, getLatestLedger } = vi.hoisted(() => {
  const db = {
    orders: new Map<string, any>(),
    transactions: new Map<string, any>(),
    checkpoints: new Map<string, any>(),
  };

  const txClient = {
    blockchainTransaction: {
      findUnique: vi.fn(async ({ where }: any) => db.transactions.get(where.sourceEventId) ?? null),
      findFirst: vi.fn(
        async ({ where }: any) =>
          [...db.transactions.values()].find(
            (t) => t.ledger === where.ledger && t.eventIndex === where.eventIndex
          ) ?? null
      ),
      create: vi.fn(async ({ data }: any) => {
        db.transactions.set(data.sourceEventId, data);
        return data;
      }),
    },
    order: {
      findUnique: vi.fn(async ({ where }: any) => db.orders.get(where.orderIdOnChain) ?? null),
      create: vi.fn(async ({ data }: any) => {
        db.orders.set(data.orderIdOnChain, data);
        return data;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const next = { ...db.orders.get(where.orderIdOnChain), ...data };
        db.orders.set(where.orderIdOnChain, next);
        return next;
      }),
    },
  };

  return { db, txClient, getEvents: vi.fn(), getLatestLedger: vi.fn() };
});

vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: vi.fn(),
  },
  scValToNative: vi.fn((v: any) => (v && typeof v === 'object' && 'native' in v ? v.native : v)),
  xdr: { ScVal: { fromXDR: vi.fn() } },
}));
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/index.js', () => ({
  config: {
    contractId: 'C-market',
    governanceContractId: '',
    rpcUrl: 'https://rpc.test',
    wsPath: '/ws',
  },
}));
vi.mock('./notificationService.js', () => ({
  NotificationService: {
    notify: vi.fn(async () => undefined),
    notifyFromEscrowEvent: vi.fn(async () => undefined),
  },
}));
vi.mock('./wsManager.js', () => ({
  wsManager: { broadcastAuthenticated: vi.fn(), broadcast: vi.fn(), broadcastTo: vi.fn() },
}));
vi.mock('./promMetrics.js', () => ({
  contractWatcherEventsPerPoll: { observe: vi.fn() },
  contractWatcherPagesPerPoll: { observe: vi.fn() },
  contractWatcherUnhandledTotal: { inc: vi.fn() },
}));
vi.mock('../config/sentry.js', () => ({ captureAlert: vi.fn() }));
vi.mock('./governanceService.js', () => ({ indexGovernanceEvent: vi.fn() }));
vi.mock('./events/escrowEventIngestionService.js', () => ({
  EscrowEventIngestionService: { ingestEvent: vi.fn(async () => undefined) },
}));
vi.mock('./identityService.js', () => ({
  IdentityService: { ensureUsersForEvent: vi.fn(async () => undefined) },
}));
vi.mock('./referralService.js', () => ({
  ReferralService: { triggerRewardOnConfirmedActivity: vi.fn(async () => undefined) },
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    ...txClient,
    $transaction: vi.fn(async (fn: any) => fn(txClient)),
    contractWatcherCheckpoint: {
      findUnique: vi.fn(async ({ where }: any) => db.checkpoints.get(where.service) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const next = { ...(db.checkpoints.get(where.service) ?? create), ...update };
        db.checkpoints.set(where.service, next);
        return next;
      }),
    },
    deadLetter: { upsert: vi.fn() },
  },
}));

import { startContractWatcher } from './contractWatcher.js';
import { BlockchainEventIngestionService } from './events/blockchainEventIngestionService.js';
import { wsManager } from './wsManager.js';
import { rpc } from '@stellar/stellar-sdk';

const orderCreatedEvent = {
  id: '0000000123-00001',
  ledger: 123,
  contractId: 'C-market',
  txHash: 'tx-hash-1',
  ledgerClosedAt: '2026-01-01T00:00:00Z',
  transactionIndex: 1,
  topic: [{ native: 'order' }, { native: 'created' }],
  value: { native: ['42', 'GBUYER', 'GFARMER', '100500000', 'USDC'] },
};

describe('order.created projection (watcher → DB)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rpc.Server).mockImplementation(function () {
      return { getEvents, getLatestLedger } as any;
    });
    db.orders.clear();
    db.transactions.clear();
    db.checkpoints.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects a fixture order.created event into an order row', async () => {
    await BlockchainEventIngestionService.ingestEvent(orderCreatedEvent as any);

    expect(db.orders.get('42')).toMatchObject({
      orderIdOnChain: '42',
      buyerAddress: 'gbuyer',
      sellerAddress: 'gfarmer',
      amount: '100500000',
      token: 'USDC',
      status: 'PENDING',
      needsBackfill: false,
    });
    expect(db.transactions.size).toBe(1);
  });

  it('is idempotent under duplicate event replay', async () => {
    await BlockchainEventIngestionService.ingestEvent(orderCreatedEvent as any);
    await BlockchainEventIngestionService.ingestEvent(orderCreatedEvent as any);

    expect(db.orders.size).toBe(1);
    expect(db.transactions.size).toBe(1);
  });

  it('watcher poll ingests order.created and advances the checkpoint', async () => {
    db.checkpoints.set('contract-watcher', {
      service: 'contract-watcher',
      lastLedger: 100,
      updatedAt: new Date(),
    });
    getLatestLedger.mockResolvedValue({ sequence: 130 });
    getEvents.mockResolvedValue({ events: [orderCreatedEvent], cursor: undefined });

    vi.useFakeTimers();
    await startContractWatcher();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(db.orders.get('42')).toMatchObject({
      orderIdOnChain: '42',
      buyerAddress: 'gbuyer',
      amount: '100500000',
      status: 'PENDING',
    });
    expect(db.checkpoints.get('contract-watcher').lastLedger).toBe(131);
    expect(wsManager.broadcastAuthenticated).toHaveBeenCalledWith(
      'order:created',
      expect.objectContaining({ orderId: '42' })
    );
  });
});
