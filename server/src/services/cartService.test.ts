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

import { checkout, addItem, updateItemQuantity } from './cartService.js';
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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

describe('cartService quantity validation (issue #958)', () => {
  const invalid = [
    ['-2', 'negative'],
    ['0', 'zero'],
    ['0.0', 'zero with fraction'],
    ['abc', 'non-numeric'],
    ['1.2.3', 'malformed'],
    ['12e3', 'scientific notation'],
    ['NaN', 'NaN text'],
    ['Infinity', 'Infinity text'],
    ['1e', 'truncated exponent'],
    ['999999999', 'range overflow (9 integer digits)'],
    ['1.234', 'unsupported precision (3 decimals)'],
  ] as const;

  it.each(invalid)('addItem rejects %s (%s), leaving the cart unchanged', async (quantity, _label) => {
    await expect(addItem('BUYER_WALLET', { product_id: 'product-1', quantity })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it.each(invalid)('updateItemQuantity rejects %s (%s)', async (quantity, _label) => {
    await expect(updateItemQuantity('BUYER_WALLET', 'item-1', quantity)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('addItem accepts a valid fractional quantity within scale', async () => {
    const tx = {
      cart: {
        findFirst: vi.fn().mockResolvedValue({ id: 'cart-1', status: 'active' }),
        create: vi.fn(),
      },
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'product-1',
          farmerWallet: 'FARMER_WALLET',
          pricePerUnit: { toString: () => '10' },
          currency: 'STRK',
          isAvailable: true,
        }),
      },
      cartItem: {
        upsert: vi.fn().mockResolvedValue({ id: 'item-1' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    mockTransaction.mockImplementation((cb: any) => cb(tx));

    await addItem('BUYER_WALLET', { product_id: 'product-1', quantity: '2.50' });

    expect(tx.cartItem.upsert).toHaveBeenCalledTimes(1);
    const call = tx.cartItem.upsert.mock.calls[0]?.[0] as any;
    expect(call.where).toEqual({ cartId_productId: { cartId: 'cart-1', productId: 'product-1' } });
    expect(Number(call.create.quantity.toString())).toBe(2.5);
    expect(call.update.quantity.increment).toBeDefined();
  });
});

describe('cartService concurrency (issue #959)', () => {
  it('converges on the winning cart when two requests race creation (P2002)', async () => {
    const tx = {
      cart: {
        // First call sees no active cart (both racers), the retry then finds the winner.
        findFirst: vi.fn(async ({ where }: any) =>
          where.status === 'active' && tx.cart.create.mock.calls.length > 0
            ? { id: 'winner-cart', status: 'active' }
            : null,
        ),
        create: vi.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
      },
      product: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    mockTransaction.mockImplementation((cb: any) => cb(tx));

    await expect(addItem('BUYER_WALLET', { product_id: 'product-1', quantity: '1' }))
      .rejects.toThrow('Product not found');
    expect(tx.cart.create).toHaveBeenCalledTimes(1);
  });

  it('checkout returns 409 when another request already checked the cart out', async () => {
    const tx = mockTx();
    (tx.cart.updateMany as any).mockResolvedValue({ count: 0 });
    mockTransaction.mockImplementation((cb: any) => cb(tx));

    await expect(checkout('BUYER_WALLET')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('new additions use a unique upsert key so one row exists per product', async () => {
    const tx = {
      cart: {
        findFirst: vi.fn().mockResolvedValue({ id: 'cart-1', status: 'active' }),
        create: vi.fn(),
      },
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'product-1',
          farmerWallet: 'FARMER_WALLET',
          pricePerUnit: { toString: () => '10' },
          currency: 'STRK',
          isAvailable: true,
        }),
      },
      cartItem: {
        upsert: vi.fn().mockResolvedValue({ id: 'item-1' }),
        findMany: vi.fn().mockResolvedValue([CART_ITEM]),
      },
    };
    mockTransaction.mockImplementation((cb: any) => cb(tx));

    await addItem('BUYER_WALLET', { product_id: 'product-1', quantity: '1' });

    const call = tx.cartItem.upsert.mock.calls[0]?.[0] as any;
    expect(call.update.quantity).toEqual({ increment: expect.anything() });
    expect(call.create.quantity).toBeDefined();
  });
});