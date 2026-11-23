import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import orderRoutes from './orderRoutes.js';

const m = vi.hoisted(() => ({
  findTransaction: vi.fn(),
  findOrder: vi.fn(),
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    blockchainTransaction: { findFirst: m.findTransaction },
    order: { findUnique: m.findOrder },
  },
}));

vi.mock('../middleware/walletAuth.js', () => ({
  requireWallet: (req: any, _res: any, next: any) => {
    req.walletAddress = req.headers['x-wallet-address'];
    next();
  },
}));

vi.mock('../controllers/orderController.js', () => ({
  OrderController: {
    getAllOrders: vi.fn(),
    getOrdersByBuyer: vi.fn(),
    getOrdersBySeller: vi.fn(),
    getSellerStats: vi.fn(),
    getOrderById: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/orders', orderRoutes);

const buyer = 'GBUYER';

describe('GET /orders/by-transaction/:txHash (Issue #1370)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the indexed order id for the authenticated buyer', async () => {
    m.findTransaction.mockResolvedValue({ orderIdOnChain: '123' });
    m.findOrder.mockResolvedValue({ orderIdOnChain: '123', buyerAddress: buyer });

    const res = await request(app)
      .get('/orders/by-transaction/tx-real')
      .set('x-wallet-address', buyer);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orderId: '123' });
  });

  it('does not disclose orders belonging to another buyer', async () => {
    m.findTransaction.mockResolvedValue({ orderIdOnChain: '123' });
    m.findOrder.mockResolvedValue({ orderIdOnChain: '123', buyerAddress: 'GSOMEONE' });

    const res = await request(app)
      .get('/orders/by-transaction/tx-real')
      .set('x-wallet-address', buyer);

    expect(res.status).toBe(404);
  });

  it('returns 404 when the transaction has not been indexed', async () => {
    m.findTransaction.mockResolvedValue(null);

    const res = await request(app)
      .get('/orders/by-transaction/tx-real')
      .set('x-wallet-address', buyer);

    expect(res.status).toBe(404);
    expect(m.findOrder).not.toHaveBeenCalled();
  });
});
