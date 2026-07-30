import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    product: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    priceHistory: { findMany: vi.fn() },
  },
}));

vi.mock('./wsManager.js', () => ({
  wsManager: { broadcast: vi.fn() },
}));

import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  softDeleteProduct,
  computeSuggestedPrice,
  getSuggestedPrice,
} from './productService.js';
import { prisma } from '../config/database.js';

const mockFindMany = vi.mocked(prisma.product.findMany);
const mockFindUnique = vi.mocked(prisma.product.findUnique);
const mockCount = vi.mocked(prisma.product.count);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockCreate = vi.mocked(prisma.product.create);
const mockUpdate = vi.mocked(prisma.product.update);
const mockPriceHistoryFindMany = vi.mocked(prisma.priceHistory.findMany);

const SAMPLE_PRODUCT = {
  id: 'prod-1',
  farmerWallet: '0xfarmer',
  name: 'Tomato',
  description: null,
  category: null,
  pricePerUnit: { toString: () => '500' } as any,
  currency: 'USDC',
  unit: 'kg',
  stockQuantity: null,
  location: null,
  imageUrl: null,
  isAvailable: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listProducts', () => {
  it('returns paginated results', async () => {
    mockTransaction.mockResolvedValue([2, [SAMPLE_PRODUCT]] as any);

    const result = await listProducts({});

    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
  });

  it('applies search filter', async () => {
    mockTransaction.mockResolvedValue([0, []] as any);

    await listProducts({ search: 'tomato' });

    expect(mockTransaction).toHaveBeenCalled();
  });

  it('respects page size limit of 100', async () => {
    mockTransaction.mockResolvedValue([5, []] as any);

    const result = await listProducts({ pageSize: '999' });

    expect(result.page_size).toBe(100);
  });
});

describe('getProductById', () => {
  it('returns the product when found', async () => {
    mockFindUnique.mockResolvedValue(SAMPLE_PRODUCT as any);

    const result = await getProductById('prod-1');

    expect(result.id).toBe('prod-1');
  });

  it('throws 404 when the product does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(getProductById('unknown')).rejects.toMatchObject({ status: 404 });
  });
});

describe('createProduct', () => {
  it('creates and returns the new product', async () => {
    mockCreate.mockResolvedValue(SAMPLE_PRODUCT as any);

    const result = await createProduct('0xfarmer', {
      name: 'Tomato',
      price_per_unit: '500',
      currency: 'USDC',
      unit: 'kg',
    });

    expect(result.id).toBe('prod-1');
  });

  it('throws 400 when required fields are missing', async () => {
    await expect(createProduct('0xfarmer', {})).rejects.toMatchObject({ status: 400 });
  });
});

describe('updateProduct', () => {
  it('updates and returns the product', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, farmerWallet: '0xfarmer' } as any);
    mockUpdate.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, name: 'Updated Tomato' } as any);

    const result = await updateProduct('prod-1', '0xfarmer', { name: 'Updated Tomato' });

    expect((result as any).name).toBe('Updated Tomato');
  });

  it('throws 404 when the product does not exist', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await expect(updateProduct('unknown', '0xfarmer', { name: 'X' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws 403 when the caller does not own the product', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, farmerWallet: '0xother' } as any);

    await expect(updateProduct('prod-1', '0xfarmer', { name: 'X' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('throws 400 when no fields are provided', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, farmerWallet: '0xfarmer' } as any);

    await expect(updateProduct('prod-1', '0xfarmer', {})).rejects.toMatchObject({ status: 400 });
  });
});

describe('softDeleteProduct', () => {
  it('sets is_available to false', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, farmerWallet: '0xfarmer' } as any);
    mockUpdate.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, isAvailable: false } as any);

    const result = await softDeleteProduct('prod-1', '0xfarmer');

    expect((result as any).is_available).toBe(false);
  });
});

describe('computeSuggestedPrice', () => {
  it('returns null below the minimum sample threshold', () => {
    expect(computeSuggestedPrice([])).toBeNull();
    expect(computeSuggestedPrice([10])).toBeNull();
    expect(computeSuggestedPrice([10, 20])).toBeNull();
  });

  it('returns the median for an odd number of samples', () => {
    expect(computeSuggestedPrice([10, 30, 20])).toBe(20);
  });

  it('is robust to a single outlier sale', () => {
    // A single wildly high outlier should not drag the suggestion up much,
    // unlike a plain average would (which would be ~252).
    expect(computeSuggestedPrice([98, 100, 102, 1000])).toBe(101);
  });
});

describe('getSuggestedPrice', () => {
  it('throws 404 when the product does not exist', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await expect(getSuggestedPrice('missing', '0xfarmer')).rejects.toMatchObject({ status: 404 });
  });

  it('throws 403 when the caller does not own the product', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, farmerWallet: '0xother' } as any);

    await expect(getSuggestedPrice('prod-1', '0xfarmer')).rejects.toMatchObject({ status: 403 });
  });

  it('has no suggestion when the farmer has no sales history', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([]);

    const result = await getSuggestedPrice('prod-1', '0xfarmer');

    expect(result).toEqual({
      has_suggestion: false,
      suggested_price: null,
      currency: null,
      sample_count: 0,
    });
  });

  it('has no suggestion for a single past sale', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([
      { price: '500', currency: 'USDC' },
    ] as any);

    const result = await getSuggestedPrice('prod-1', '0xfarmer');

    expect(result.has_suggestion).toBe(false);
    expect(result.sample_count).toBe(1);
  });

  it('suggests the median price once enough sales history exists', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([
      { price: '600', currency: 'USDC' },
      { price: '500', currency: 'USDC' },
      { price: '550', currency: 'USDC' },
    ] as any);

    const result = await getSuggestedPrice('prod-1', '0xfarmer');

    expect(result).toEqual({
      has_suggestion: true,
      suggested_price: '550',
      currency: 'USDC',
      sample_count: 3,
    });
  });

  it('is not skewed by a single outlier sale', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([
      { price: '98', currency: 'USDC' },
      { price: '100', currency: 'USDC' },
      { price: '102', currency: 'USDC' },
      { price: '1000', currency: 'USDC' },
    ] as any);

    const result = await getSuggestedPrice('prod-1', '0xfarmer');

    expect(result.suggested_price).toBe('101');
  });

  it('scopes the query to the calling farmer and same category', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([]);

    await getSuggestedPrice('prod-1', '0xfarmer');

    expect(mockPriceHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { product: { farmerWallet: '0xfarmer', category: 'Vegetables' } },
      }),
    );
  });

  it('falls back to the same product when it has no category', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: null } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([]);

    await getSuggestedPrice('prod-1', '0xfarmer');

    expect(mockPriceHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { product: { id: 'prod-1', farmerWallet: '0xfarmer' } },
      }),
    );
  });
});
