import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
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
      unit: null,
      sample_count: 0,
    });
  });

  it('has no suggestion for a single past sale', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([{ price: '500', currency: 'USDC' }] as any);

    const result = await getSuggestedPrice('prod-1', '0xfarmer');

    expect(result.has_suggestion).toBe(false);
    expect(result.sample_count).toBe(1);
    expect(result.currency).toBeNull();
    expect(result.unit).toBeNull();
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
      unit: 'kg',
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
    expect(result.currency).toBe('USDC');
    expect(result.unit).toBe('kg');
  });

  it('keeps suggestions within the target currency and unit', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([]);

    await getSuggestedPrice('prod-1', '0xfarmer');

    expect(mockPriceHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          product: {
            farmerWallet: '0xfarmer',
            category: 'Vegetables',
            currency: 'USDC',
            unit: 'kg',
          },
        },
      })
    );
  });

  it('yields no suggestion when too few comparable rows remain after filtering', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([
      { price: '500', currency: 'USDC' },
      { price: '510', currency: 'USDC' },
    ] as any);

    const result = await getSuggestedPrice('prod-1', '0xfarmer');

    expect(result.has_suggestion).toBe(false);
    expect(result.suggested_price).toBeNull();
    expect(result.sample_count).toBe(2);
  });

  it('scopes the query to the calling farmer and same category', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: 'Vegetables' } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([]);

    await getSuggestedPrice('prod-1', '0xfarmer');

    expect(mockPriceHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          product: {
            farmerWallet: '0xfarmer',
            category: 'Vegetables',
            currency: 'USDC',
            unit: 'kg',
          },
        },
      })
    );
  });

  it('falls back to the same product when it has no category', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, category: null } as any);
    mockPriceHistoryFindMany.mockResolvedValueOnce([]);

    await getSuggestedPrice('prod-1', '0xfarmer');

    expect(mockPriceHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          product: {
            id: 'prod-1',
            farmerWallet: '0xfarmer',
            currency: 'USDC',
            unit: 'kg',
          },
        },
      })
    );
  });
});

// ── GET /products query contract (Issue #1145) ──────────────────────────────
// Pins the Prisma query each documented filter, sort and paging input
// produces, so a renamed or dropped parameter fails here instead of silently
// returning an unfiltered list.
describe('listProducts query contract (#1145)', () => {
  const whereOf = () => mockFindMany.mock.calls[0]![0]!.where;
  const queryOf = () => mockFindMany.mock.calls[0]![0]!;

  beforeEach(() => {
    mockTransaction.mockResolvedValue([0, []] as any);
  });

  it('defaults to available products only', async () => {
    await listProducts({});
    expect(whereOf()).toEqual({ isAvailable: true });
    expect(mockCount).toHaveBeenCalledWith({ where: { isAvailable: true } });
  });

  it('include_unavailable drops the availability filter', async () => {
    await listProducts({ includeUnavailable: true });
    expect(whereOf()).toEqual({});
  });

  it('search matches name, description or category case-insensitively', async () => {
    await listProducts({ search: 'Tomato' });
    expect(whereOf()).toEqual({
      isAvailable: true,
      OR: [
        { name: { contains: 'Tomato', mode: 'insensitive' } },
        { description: { contains: 'Tomato', mode: 'insensitive' } },
        { category: { contains: 'Tomato', mode: 'insensitive' } },
      ],
    });
  });

  it('category is an exact match', async () => {
    await listProducts({ category: 'Vegetables' });
    expect(whereOf()).toEqual({ isAvailable: true, category: 'Vegetables' });
  });

  it('farmer (seller) is matched on the lower-cased wallet', async () => {
    await listProducts({ farmer: 'GFARMERWALLET' });
    expect(whereOf()).toEqual({ isAvailable: true, farmerWallet: 'gfarmerwallet' });
  });

  it('location is a case-insensitive substring match', async () => {
    await listProducts({ location: 'Lagos' });
    expect(whereOf()).toEqual({
      isAvailable: true,
      location: { contains: 'Lagos', mode: 'insensitive' },
    });
  });

  it('minPrice alone applies a lower bound', async () => {
    await listProducts({ minPrice: '10' });
    expect(whereOf().pricePerUnit).toEqual({ gte: expect.anything() });
    expect(String(whereOf().pricePerUnit.gte)).toBe('10');
  });

  it('maxPrice alone applies an upper bound', async () => {
    await listProducts({ maxPrice: '99.5' });
    expect(whereOf().pricePerUnit).toEqual({ lte: expect.anything() });
    expect(String(whereOf().pricePerUnit.lte)).toBe('99.5');
  });

  it('minPrice and maxPrice together form an inclusive range', async () => {
    await listProducts({ minPrice: '10', maxPrice: '20' });
    const range = whereOf().pricePerUnit;
    expect(String(range.gte)).toBe('10');
    expect(String(range.lte)).toBe('20');
  });

  it('ignores non-numeric price bounds rather than failing the request', async () => {
    await listProducts({ minPrice: 'cheap', maxPrice: 'abc' });
    expect(whereOf()).toEqual({ isAvailable: true });
  });

  it('combines every filter in one query', async () => {
    await listProducts({
      farmer: 'GF',
      category: 'Grains',
      search: 'rice',
      location: 'Kano',
      minPrice: '1',
      maxPrice: '5',
    });
    const where = whereOf();
    expect(where).toMatchObject({
      isAvailable: true,
      farmerWallet: 'gf',
      category: 'Grains',
      location: { contains: 'Kano', mode: 'insensitive' },
    });
    expect(where.OR).toHaveLength(3);
    expect(where.pricePerUnit).toHaveProperty('gte');
    expect(where.pricePerUnit).toHaveProperty('lte');
  });

  it('count and page use the same filter', async () => {
    await listProducts({ category: 'Fruit', search: 'mango' });
    expect(mockCount.mock.calls[0]![0]!.where).toEqual(whereOf());
  });

  describe('sorting', () => {
    it('orders newest first (the only sort the server implements today)', async () => {
      await listProducts({});
      expect(queryOf().orderBy).toEqual({ createdAt: 'desc' });
    });

    // The client sends `sort` (newest | price-asc | price-desc | rating |
    // distance | popular) but the route does not read it yet. Tracked by #1132.
    it.todo('price-asc orders by pricePerUnit ascending (#1132)');
    it.todo('price-desc orders by pricePerUnit descending (#1132)');
    it.todo('rating, distance and popular sorts (#1132)');
  });

  describe('pagination', () => {
    it('defaults to page 1 of 20', async () => {
      await listProducts({});
      expect(queryOf()).toMatchObject({ take: 20, skip: 0 });
    });

    it('skips (page - 1) * page_size rows', async () => {
      await listProducts({ page: '3', pageSize: '10' });
      expect(queryOf()).toMatchObject({ take: 10, skip: 20 });
    });

    it.each(['0', '-1', 'abc', ''])('falls back to page 1 for page=%j', async (page) => {
      const result = await listProducts({ page });
      expect(result.page).toBe(1);
      expect(queryOf().skip).toBe(0);
    });

    it.each(['0', '-5', 'x'])('falls back to 20 for page_size=%j', async (pageSize) => {
      const result = await listProducts({ pageSize });
      expect(result.page_size).toBe(20);
      expect(queryOf().take).toBe(20);
    });

    it('accepts page_size exactly at the 100 cap', async () => {
      const result = await listProducts({ pageSize: '100' });
      expect(result.page_size).toBe(100);
      expect(queryOf().take).toBe(100);
    });

    it('caps page_size at 100', async () => {
      await listProducts({ pageSize: '101' });
      expect(queryOf().take).toBe(100);
    });

    it('reports totalPages rounded up', async () => {
      mockTransaction.mockResolvedValue([41, []] as any);
      const result = await listProducts({ pageSize: '20' });
      expect(result).toMatchObject({ total: 41, totalPages: 3 });
    });

    it('reports zero pages for an empty result', async () => {
      const result = await listProducts({});
      expect(result).toMatchObject({ total: 0, totalPages: 0, items: [] });
    });

    it('returns an empty page past the last one without clamping', async () => {
      mockTransaction.mockResolvedValue([5, []] as any);
      const result = await listProducts({ page: '9', pageSize: '5' });
      expect(result).toMatchObject({ page: 9, total: 5, totalPages: 1, items: [] });
      expect(queryOf().skip).toBe(40);
    });
  });
});
