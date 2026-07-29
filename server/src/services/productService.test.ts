import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    product: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
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
} from './productService.js';
import { prisma } from '../config/database.js';

const mockFindMany = vi.mocked(prisma.product.findMany);
const mockFindUnique = vi.mocked(prisma.product.findUnique);
const mockCount = vi.mocked(prisma.product.count);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockCreate = vi.mocked(prisma.product.create);
const mockUpdate = vi.mocked(prisma.product.update);

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
