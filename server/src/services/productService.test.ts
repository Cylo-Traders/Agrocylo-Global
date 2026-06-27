import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database.js', () => ({
  query: vi.fn(),
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
import * as db from '../config/database.js';

const mockQuery = vi.mocked(db.query);

const SAMPLE_PRODUCT = {
  id: 'prod-1',
  farmer_wallet: '0xfarmer',
  name: 'Tomato',
  price_per_unit: '500',
  currency: 'USDC',
  unit: 'kg',
  is_available: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listProducts', () => {
  it('returns paginated results', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '2' }] } as any)
      .mockResolvedValueOnce({ rows: [SAMPLE_PRODUCT] } as any);

    const result = await listProducts({});

    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
  });

  it('applies search filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await listProducts({ search: 'tomato' });

    const countCall = mockQuery.mock.calls[0];
    expect(countCall?.[0]).toContain('ILIKE');
  });

  it('respects page size limit of 100', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '5' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await listProducts({ pageSize: '999' });

    expect(result.page_size).toBe(100);
  });
});

describe('getProductById', () => {
  it('returns the product when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [SAMPLE_PRODUCT] } as any);

    const result = await getProductById('prod-1');

    expect(result).toEqual(SAMPLE_PRODUCT);
  });

  it('throws 404 when the product does not exist', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    await expect(getProductById('unknown')).rejects.toMatchObject({ status: 404 });
  });
});

describe('createProduct', () => {
  it('creates and returns the new product', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'prod-2' }] } as any)
      .mockResolvedValueOnce({ rows: [SAMPLE_PRODUCT] } as any);

    const result = await createProduct('0xfarmer', {
      name: 'Tomato',
      price_per_unit: '500',
      currency: 'USDC',
      unit: 'kg',
    });

    expect(result).toEqual(SAMPLE_PRODUCT);
  });

  it('throws 400 when required fields are missing', async () => {
    await expect(createProduct('0xfarmer', {})).rejects.toMatchObject({ status: 400 });
  });
});

describe('updateProduct', () => {
  it('updates and returns the product', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ farmer_wallet: '0xfarmer' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_PRODUCT, name: 'Updated Tomato' }] } as any);

    const result = await updateProduct('prod-1', '0xfarmer', { name: 'Updated Tomato' });

    expect((result as typeof SAMPLE_PRODUCT).name).toBe('Updated Tomato');
  });

  it('throws 404 when the product does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(updateProduct('unknown', '0xfarmer', { name: 'X' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws 403 when the caller does not own the product', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ farmer_wallet: '0xother' }] } as any);

    await expect(updateProduct('prod-1', '0xfarmer', { name: 'X' })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('throws 400 when no fields are provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ farmer_wallet: '0xfarmer' }] } as any);

    await expect(updateProduct('prod-1', '0xfarmer', {})).rejects.toMatchObject({ status: 400 });
  });
});

describe('softDeleteProduct', () => {
  it('sets is_available to false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ farmer_wallet: '0xfarmer' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_PRODUCT, is_available: false }] } as any);

    const result = await softDeleteProduct('prod-1', '0xfarmer');

    expect((result as typeof SAMPLE_PRODUCT).is_available).toBe(false);
  });
});
