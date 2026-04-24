import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../app.js';
import { ApiError } from '../http/errors.js';

vi.mock('../services/productService.js', () => ({
  listProducts: vi.fn(),
  getProductById: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  softDeleteProduct: vi.fn(),
}));

vi.mock('../services/cartService.js', () => ({
  getActiveCart: vi.fn(),
  addItem: vi.fn(),
  updateItemQuantity: vi.fn(),
  removeItem: vi.fn(),
  clearCart: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock('../services/ordersService.js', () => ({
  listBuyerOrders: vi.fn(),
  parseOrderStatusFilter: vi.fn(),
}));

import * as productService from '../services/productService.js';
import * as cartService from '../services/cartService.js';
import * as ordersService from '../services/ordersService.js';

describe('Product and cart API endpoints', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /products returns paginated response', async () => {
    vi.mocked(productService.listProducts).mockResolvedValue({
      page: 1,
      page_size: 20,
      items: [{ id: 'p1', name: 'Tomato' }],
    });

    const res = await request(app).get('/products');
    expect(res.status).toBe(200);
    expect(res.body.page_size).toBe(20);
  });

  it('POST /products rejects when auth header missing', async () => {
    const res = await request(app).post('/products').send({ name: 'Tomato' });
    expect(res.status).toBe(401);
  });

  it('GET /products/:id returns RFC7807 on service errors', async () => {
    vi.mocked(productService.getProductById).mockRejectedValue(
      new ApiError(404, 'Not Found', 'Product not found'),
    );
    const res = await request(app).get('/products/00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.title).toBe('Not Found');
  });

  it('GET /cart returns grouped payload for authenticated buyer', async () => {
    vi.mocked(cartService.getActiveCart).mockResolvedValue({
      cart_id: 'c1',
      groups: [
        {
          farmer_wallet: '0x1111111111111111111111111111111111111111',
          farmer_name: 'Farm',
          currency: 'USDC',
          subtotal: '0',
          items: [],
        },
      ],
    });
    const res = await request(app)
      .get('/cart')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.groups)).toBe(true);
  });

  it('POST /cart/checkout returns order payload', async () => {
    vi.mocked(cartService.checkout).mockResolvedValue({
      orders: [
        {
          farmer_wallet: '0x1111111111111111111111111111111111111111',
          farmer_name: 'Farm',
          token: 'STRK',
          token_address: '0x04718f5a...',
          gross_amount: '700',
          fee_amount: '21',
          net_amount: '679',
          items: [],
        },
      ],
      total_gross: '700',
      total_fee: '21',
      total_net: '679',
    });

    const res = await request(app)
      .post('/cart/checkout')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111');

    expect(res.status).toBe(200);
    expect(res.body.orders[0].fee_amount).toBe('21');
  });

  it('GET /orders returns projected buyer orders', async () => {
    vi.mocked(ordersService.parseOrderStatusFilter).mockReturnValue('active');
    vi.mocked(ordersService.listBuyerOrders).mockResolvedValue({
      items: [
        {
          order_id: '1',
          status: 'PENDING',
          seller_address: '0x2222222222222222222222222222222222222222',
        },
      ],
    });

    const res = await request(app)
      .get('/orders?status=active')
      .set('x-wallet-address', '0x1111111111111111111111111111111111111111');

    expect(res.status).toBe(200);
    expect(res.body.items[0].status).toBe('PENDING');
    expect(ordersService.parseOrderStatusFilter).toHaveBeenCalledWith('active');
    expect(ordersService.listBuyerOrders).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      'active',
    );
  });
});
