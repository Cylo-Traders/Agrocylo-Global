import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';

vi.mock('../config/database.js', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock('./wsManager.js', () => ({
  wsManager: { broadcastTo: vi.fn() },
}));

import { checkout } from './cartService.js';
import { prisma } from '../config/database.js';

const mockTransaction = vi.mocked(prisma.$transaction);

const CART_ITEM = {
  id: 'item-1',
  productId: 'product-1',
  quantity: { toString: () => '2' },
  unitPrice: { toString: () => '10' },
  currency: 'STRK',
  farmerWallet: 'FARMER_WALLET',
  product: {
    name: 'Maize',
    unit: 'kg',
    isAvailable: true,
    farmer: { name: 'Jane Farmer' },
  },
};

function mockTx(overrides: { status?: string } = {}) {
  return {
    cart: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cart-1', status: overrides.status ?? 'active' }),
      update: vi.fn().mockResolvedValue({}),
    },
    cartItem: {
      findMany: vi.fn().mockResolvedValue([CART_ITEM]),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cartService.checkout', () => {
  it('does not return a hardcoded/malformed token_address field', async () => {
    const tx = mockTx();
    mockTransaction.mockImplementation((cb: any) => cb(tx));

    const result = await checkout('BUYER_WALLET');

    expect(result.orders).toHaveLength(1);
    for (const order of result.orders) {
      // The field must either be absent, or (if reintroduced later) a real
      // Stellar/Soroban StrKey contract ID rather than a Starknet-style
      // 0x placeholder.
      expect(Object.prototype.hasOwnProperty.call(order, 'token_address')).toBe(false);
      const maybeAddress = (order as Record<string, unknown>)['token_address'];
      if (typeof maybeAddress === 'string') {
        expect(StrKey.isValidContract(maybeAddress)).toBe(true);
      }
    }
  });

  it('still returns the currency under "token"', async () => {
    const tx = mockTx();
    mockTransaction.mockImplementation((cb: any) => cb(tx));

    const result = await checkout('BUYER_WALLET');

    expect(result.orders[0]?.token).toBe('STRK');
  });
});