import express from 'express';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { createProduct, getProductById, listProducts, softDeleteProduct, updateProduct } from '../services/productService.js';

const router = express.Router();

router.get('/products', async (req, res) => {
  const result = await listProducts({
    farmer: typeof req.query['farmer'] === 'string' ? req.query['farmer'] : undefined,
    category: typeof req.query['category'] === 'string' ? req.query['category'] : undefined,
    search: typeof req.query['search'] === 'string' ? req.query['search'] : undefined,
    location: typeof req.query['location'] === 'string' ? req.query['location'] : undefined,
    minPrice: typeof req.query['minPrice'] === 'string' ? req.query['minPrice'] : undefined,
    maxPrice: typeof req.query['maxPrice'] === 'string' ? req.query['maxPrice'] : undefined,
    page: typeof req.query['page'] === 'string' ? req.query['page'] : undefined,
    pageSize: typeof req.query['page_size'] === 'string' ? req.query['page_size'] : undefined,
    includeUnavailable:
      typeof req.query['include_unavailable'] === 'string'
        ? req.query['include_unavailable'] === 'true' ||
          req.query['include_unavailable'] === '1'
        : undefined,
  });
  res.status(200).json(result);
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const data = await getProductById(String(req.params['id']));
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/products', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const created = await createProduct(req.walletAddress, req.body ?? {});
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.patch('/products/:id', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const updated = await updateProduct(String(req.params['id']), req.walletAddress, req.body ?? {});
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete('/products/:id', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const updated = await softDeleteProduct(String(req.params['id']), req.walletAddress);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

export function apiErrorHandler(error: unknown, req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }
  next(error);
}

export default router;
