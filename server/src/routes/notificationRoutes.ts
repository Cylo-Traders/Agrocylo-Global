import express from 'express';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { ApiError } from '../http/errors.js';
import { listNotifications, markNotificationRead } from '../services/notificationService.js';

const router = express.Router();

router.get('/notifications', requireWallet, async (req: WalletRequest, res, next) => {
  try {
    if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');

    const data = await listNotifications(req.walletAddress, {
      unreadOnly:
        typeof req.query['unread_only'] === 'string'
          ? req.query['unread_only']
          : undefined,
      limit: typeof req.query['limit'] === 'string' ? req.query['limit'] : undefined,
    });

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/notifications/:id/read',
  requireWallet,
  async (req: WalletRequest, res, next) => {
    try {
      if (!req.walletAddress) throw new ApiError(401, 'Unauthorized', 'Missing wallet');
      const notificationId = String(req.params['id'] ?? '');
      if (!notificationId) {
        throw new ApiError(400, 'Bad Request', 'Missing notification id');
      }

      await markNotificationRead(req.walletAddress, notificationId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
