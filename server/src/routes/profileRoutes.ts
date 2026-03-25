import express from 'express';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { getProfile, createProfile, updateProfile } from '../services/profileService.js';

const router = express.Router();

router.get('/profiles/:wallet_address', async (req, res, next) => {
  try {
    const data = await getProfile(req.params['wallet_address']!);
    res.status(200).json(data);
  } catch (error) { next(error); }
});

router.post('/profiles', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    const data = await createProfile(req.walletAddress, req.body ?? {});
    res.status(201).json(data);
  } catch (error) { next(error); }
});

router.patch('/profiles/:wallet_address', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    const data = await updateProfile(req.params['wallet_address']!, req.walletAddress, req.body ?? {});
    res.status(200).json(data);
  } catch (error) { next(error); }
});

export function profileErrorHandler(error: unknown, req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (error instanceof ApiError) { sendProblem(res, req, error); return; }
  next(error);
}

export default router;
