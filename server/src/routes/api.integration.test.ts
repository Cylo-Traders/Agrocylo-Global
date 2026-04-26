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

vi.mock('../services/notificationService.js', () => ({
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

import * as productService from '../services/productService.js';
import * as cartService from '../services/cartService.js';
import * as notificationService from '../services/notificationService.js';

describe('Product and cart API endpoints', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /products returns paginated response', async () => {
    vi.mocked(productService.listProducts).mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 1,
      totalPages: 1,
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

  it('GET /products supports search filter', async () => {
    vi.mocked(productService.listProducts).mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 1,
      totalPages: 1,
      items: [{ id: 'p1', name: 'Maize' }],
    });

    const res = await request(app).get('/products?search=maize');
    expect(res.status).toBe(200);
    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'maize' })
    );
  });

  it('GET /products supports location filter', async () => {
    vi.mocked(productService.listProducts).mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 0,
      totalPages: 0,
      items: [],
    });

    const res = await request(app).get('/products?location=Lagos');
    expect(res.status).toBe(200);
    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'Lagos' })
    );
  });

  it('GET /products supports price range filters', async () => {
    vi.mocked(productService.listProducts).mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 2,
      totalPages: 1,
      items: [{ id: 'p1' }, { id: 'p2' }],
    });

    const res = await request(app).get('/products?minPrice=1000&maxPrice=5000');
    expect(res.status).toBe(200);
    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ minPrice: '1000', maxPrice: '5000' })
    );
  });

  it('GET /products supports combined filters', async () => {
    vi.mocked(productService.listProducts).mockResolvedValue({
      page: 1,
      page_size: 20,
      total: 1,
      totalPages: 1,
      items: [{ id: 'p1', name: 'Rice', location: 'Abuja', category: 'Grains' }],
    });

    const res = await request(app).get('/products?search=rice&location=Abuja&minPrice=2000&maxPrice=10000&category=Grains');
    expect(res.status).toBe(200);
    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'rice',
        location: 'Abuja',
        minPrice: '2000',
        maxPrice: '10000',
        category: 'Grains'
      })
    );
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

  it('GET /notifications returns unread items for a Stellar wallet', async () => {
    vi.mocked(notificationService.listNotifications).mockResolvedValue([
      {
        id: 'n1',
        walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        message: 'Order funded',
        orderId: '42',
        type: 'created',
        isRead: false,
        createdAt: new Date('2026-04-24T12:00:00.000Z'),
      },
    ]);

    const res = await request(app)
      .get('/notifications')
      .set('x-wallet-address', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].orderId).toBe('42');
    expect(notificationService.listNotifications).toHaveBeenCalledWith(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      { unreadOnly: true, limit: undefined },
    );
  });

  it('POST /notifications/read marks items as read', async () => {
    vi.mocked(notificationService.markNotificationsRead).mockResolvedValue({ count: 2 });

    const res = await request(app)
      .post('/notifications/read')
      .set('x-wallet-address', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')
      .send({ ids: ['n1', 'n2'] });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(notificationService.markNotificationsRead).toHaveBeenCalledWith(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      ['n1', 'n2'],
    );
  });
});
