import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database.js', () => ({
  prisma: {
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    dispute: {
      count: vi.fn(),
    },
  },
}));

import { OrderService } from './orderService.js';
import { prisma } from '../config/database.js';

const mockOrder = vi.mocked(prisma.order);
const mockDispute = vi.mocked(prisma.dispute);

const SAMPLE_ORDER = {
  id: 'o1',
  orderIdOnChain: 'chain-1',
  buyerAddress: 'BUYER',
  sellerAddress: 'SELLER',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OrderService.getAll', () => {
  it('returns all orders ordered by creation date', async () => {
    mockOrder.findMany.mockResolvedValueOnce([SAMPLE_ORDER] as any);

    const result = await OrderService.getAll();

    expect(result).toEqual([SAMPLE_ORDER]);
    expect(mockOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    );
  });
});

describe('OrderService.getByOrderId', () => {
  it('returns the matching order', async () => {
    mockOrder.findUnique.mockResolvedValueOnce(SAMPLE_ORDER as any);

    const result = await OrderService.getByOrderId('chain-1');

    expect(result).toEqual(SAMPLE_ORDER);
    expect(mockOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderIdOnChain: 'chain-1' } })
    );
  });

  it('returns null when the order does not exist', async () => {
    mockOrder.findUnique.mockResolvedValueOnce(null);

    const result = await OrderService.getByOrderId('unknown');

    expect(result).toBeNull();
  });
});

describe('OrderService.getByBuyerAddress', () => {
  it('returns orders filtered by buyer', async () => {
    mockOrder.findMany.mockResolvedValueOnce([SAMPLE_ORDER] as any);

    const result = await OrderService.getByBuyerAddress('BUYER');

    expect(result).toEqual([SAMPLE_ORDER]);
    expect(mockOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buyerAddress: 'BUYER' } })
    );
  });
});

describe('OrderService.getByFarmerAddress', () => {
  it('returns orders filtered by seller', async () => {
    mockOrder.findMany.mockResolvedValueOnce([SAMPLE_ORDER] as any);

    const result = await OrderService.getByFarmerAddress('SELLER');

    expect(result).toEqual([SAMPLE_ORDER]);
    expect(mockOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sellerAddress: 'SELLER' } })
    );
  });
});

describe('OrderService.getSellerStats', () => {
  it('returns zero-based stats when the seller has no orders', async () => {
    mockOrder.count.mockResolvedValue(0 as any);
    mockDispute.count.mockResolvedValue(0 as any);

    const stats = await OrderService.getSellerStats('SELLER');

    expect(stats).toEqual({
      totalOrders: 0,
      successRate: 100,
      disputeRate: 0,
      refundRatio: 0,
    });
    expect(mockOrder.count).toHaveBeenCalledTimes(3);
  });

  it('computes rates correctly when orders exist', async () => {
    mockOrder.count
      .mockResolvedValueOnce(10 as any)
      .mockResolvedValueOnce(8 as any)
      .mockResolvedValueOnce(1 as any);
    mockDispute.count.mockResolvedValueOnce(2 as any);

    const stats = await OrderService.getSellerStats('SELLER');

    expect(stats.totalOrders).toBe(10);
    expect(stats.successRate).toBeCloseTo(80);
    expect(stats.disputeRate).toBeCloseTo(20);
    expect(stats.refundRatio).toBeCloseTo(10);
  });
});
