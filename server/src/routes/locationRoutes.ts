import express from 'express';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { ApiError, sendProblem } from '../http/errors.js';
import { getFarmerLocations, getLocationByWallet, setLocation, updateLocation, deleteLocation } from '../services/locationService.js';

const router = express.Router();

function assertBodyWalletMatchesSession(body: unknown, sessionWallet: string): void {
  if (!body || typeof body !== 'object') return;
  const record = body as Record<string, unknown>;
  const claimed = record['wallet_address'] ?? record['walletAddress'];
  if (typeof claimed === 'string' && claimed.trim()) {
    if (claimed.trim().toLowerCase() !== sessionWallet.toLowerCase()) {
      throw new ApiError(403, 'Forbidden', 'Wallet in body does not match session', 'https://cylos.io/errors/forbidden');
    }
  }
}

router.get('/locations/farmers', async (req, res, next) => {
  try {
    const data = await getFarmerLocations(req.query);
    res.status(200).json(data);
  } catch (error) { next(error); }
});

router.get('/locations/me', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    const data = await getLocationByWallet(req.walletAddress);
    res.status(200).json(data);
  } catch (error) { next(error); }
});

router.post('/locations', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet', 'https://cylos.io/errors/unauthorized');
    assertBodyWalletMatchesSession(req.body, req.walletAddress);
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
