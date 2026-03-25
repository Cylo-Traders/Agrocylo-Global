import express from 'express';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { getFarmerLocations, setLocation, updateLocation, deleteLocation } from '../services/locationService.js';

const router = express.Router();

router.get('/locations/farmers', async (req, res, next) => {
  try {
    const data = await getFarmerLocations(req.query);
    res.status(200).json(data);
  } catch (error) { next(error); }
});

router.post('/locations', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    const data = await setLocation(req.walletAddress, req.body ?? {});
    res.status(201).json(data);
  } catch (error) { next(error); }
});

router.patch('/locations/:wallet_address', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    const data = await updateLocation(req.params['wallet_address']!, req.walletAddress, req.body ?? {});
    res.status(200).json(data);
  } catch (error) { next(error); }
});

router.delete('/locations/:wallet_address', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    await deleteLocation(req.params['wallet_address']!, req.walletAddress);
    res.status(204).send();
  } catch (error) { next(error); }
});

export function locationErrorHandler(error: unknown, req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (error instanceof ApiError) { sendProblem(res, req, error); return; }
  next(error);
}

export default router;
