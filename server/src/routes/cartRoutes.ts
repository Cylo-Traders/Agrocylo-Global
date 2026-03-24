import express from 'express';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { ApiError } from '../http/errors.js';
import { addItem, checkout, clearCart, getActiveCart, removeItem, updateItemQuantity } from '../services/cartService.js';

const router = express.Router();

router.get('/cart', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const result = await getActiveCart(req.walletAddress);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/cart/items', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const result = await addItem(req.walletAddress, req.body ?? {});
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.patch('/cart/items/:id', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const quantity = String(req.body?.quantity ?? '');
    if (!quantity) throw new ApiError(400, 'Bad Request', 'quantity is required');
    const result = await updateItemQuantity(req.walletAddress, String(req.params['id']), quantity);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/cart/items/:id', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const result = await removeItem(req.walletAddress, String(req.params['id']));
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/cart', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const result = await clearCart(req.walletAddress);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/cart/checkout', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
    const result = await checkout(req.walletAddress);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
