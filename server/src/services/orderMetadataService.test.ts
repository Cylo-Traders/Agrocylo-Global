import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../http/errors.js';

vi.mock('../config/database.js', () => ({
  prisma: {
    order: {
      findUnique: vi.fn(),
    },
    orderMetadata: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { createOrderMetadata, getOrderMetadata } from './orderMetadataService.js';
import { prisma } from '../config/database.js';

const mockOrder = vi.mocked(prisma.order);
const mockMetadata = vi.mocked(prisma.orderMetadata);

const SAMPLE_ORDER = {
  id: 'o1',
  orderIdOnChain: 'chain-1',
  buyerAddress: 'GBUYER',
  sellerAddress: 'GFARMER',
  amount: '100',
  token: 'XLM',
  status: 'PENDING',
};

const SAMPLE_METADATA = {
  on_chain_order_id: 'chain-1',
  description: 'Fresh tomatoes',
  farmer_address: 'GFARMER',
  buyer_address: 'GBUYER',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createOrderMetadata', () => {
  it('derives addresses from Order and allows buyer to create', async () => {
    mockOrder.findUnique.mockResolvedValueOnce(SAMPLE_ORDER as any);
    mockMetadata.create.mockResolvedValueOnce(SAMPLE_METADATA as any);

    const result = await createOrderMetadata(
      { on_chain_order_id: 'chain-1', description: 'Fresh tomatoes' },
      'GBUYER'
    );

    expect(result).toEqual(SAMPLE_METADATA);
    expect(mockMetadata.create).toHaveBeenCalledWith({
      data: {
        on_chain_order_id: 'chain-1',
        description: 'Fresh tomatoes',
        farmer_address: 'GFARMER',
        buyer_address: 'GBUYER',
      },
    });
  });

  it('allows farmer to create metadata', async () => {
    mockOrder.findUnique.mockResolvedValueOnce(SAMPLE_ORDER as any);
    mockMetadata.create.mockResolvedValueOnce(SAMPLE_METADATA as any);

    await createOrderMetadata({ on_chain_order_id: 'chain-1', description: 'Ok' }, 'GFARMER');

    expect(mockMetadata.create).toHaveBeenCalled();
  });

  it('rejects third-party wallet squatting metadata', async () => {
    mockOrder.findUnique.mockResolvedValueOnce(SAMPLE_ORDER as any);

    await expect(
      createOrderMetadata(
        {
          on_chain_order_id: 'chain-1',
          description: 'Attacker description',
          farmer_address: 'GFARMER',
          buyer_address: 'GBUYER',
        },
        'GATTACKER'
      )
    ).rejects.toMatchObject({ status: 403 });

    expect(mockMetadata.create).not.toHaveBeenCalled();
  });

  it('ignores client-supplied farmer/buyer addresses', async () => {
    mockOrder.findUnique.mockResolvedValueOnce(SAMPLE_ORDER as any);
    mockMetadata.create.mockResolvedValueOnce(SAMPLE_METADATA as any);

    await createOrderMetadata(
      {
        on_chain_order_id: 'chain-1',
        description: 'Legit',
        farmer_address: 'GFAKE',
        buyer_address: 'GFAKE2',
      },
      'GBUYER'
    );

    expect(mockMetadata.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        farmer_address: 'GFARMER',
        buyer_address: 'GBUYER',
      }),
    });
  });

  it('returns 404 when order does not exist', async () => {
    mockOrder.findUnique.mockResolvedValueOnce(null);

    await expect(
      createOrderMetadata({ on_chain_order_id: 'missing', description: 'x' }, 'GBUYER')
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockMetadata.create).not.toHaveBeenCalled();
  });

  it('validates required fields', async () => {
    await expect(createOrderMetadata({ description: 'no id' }, 'GBUYER')).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('getOrderMetadata', () => {
  it('allows buyer access', async () => {
    mockMetadata.findUnique.mockResolvedValueOnce(SAMPLE_METADATA as any);
    mockOrder.findUnique.mockResolvedValueOnce(SAMPLE_ORDER as any);

    const result = await getOrderMetadata('chain-1', 'GBUYER');
    expect(result).toEqual(SAMPLE_METADATA);
  });

  it('allows farmer access', async () => {
    mockMetadata.findUnique.mockResolvedValueOnce(SAMPLE_METADATA as any);
    mockOrder.findUnique.mockResolvedValueOnce(SAMPLE_ORDER as any);

    const result = await getOrderMetadata('chain-1', 'GFARMER');
    expect(result).toEqual(SAMPLE_METADATA);
  });

  it('rejects third-party access', async () => {
    mockMetadata.findUnique.mockResolvedValueOnce(SAMPLE_METADATA as any);
    mockOrder.findUnique.mockResolvedValueOnce(SAMPLE_ORDER as any);

    await expect(getOrderMetadata('chain-1', 'GATTACKER')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('returns 404 when metadata missing', async () => {
    mockMetadata.findUnique.mockResolvedValueOnce(null);

    await expect(getOrderMetadata('missing', 'GBUYER')).rejects.toMatchObject({
      status: 404,
    });
  });
});
