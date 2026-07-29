import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateQuery, validateBody } from '../middleware/validate.js';
import { problemDetail } from '../middleware/errors.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import {
  listNotifications,
  markAsRead,
  markAllAsRead,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../services/notificationService.js';

const router = Router();

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  unreadOnly: z.coerce.boolean().optional(),
});

const PreferencesSchema = z.record(z.string(), z.boolean());

router.get(
  '/notifications',
  requireWallet,
  validateQuery(ListQuerySchema),
  async (req: WalletRequest, res: Response) => {
    try {
      const { limit, unreadOnly } = req.query as Record<string, unknown>;
      const notifications = await listNotifications(req.walletAddress!, {
        limit: limit as number | undefined,
        unreadOnly: unreadOnly as boolean | undefined,
      });
      res.json(notifications);
    } catch (err) {
      problemDetail(res, req, 500, 'Failed to fetch notifications');
    }
  },
);

router.patch(
  '/notifications/:id/read',
  requireWallet,
  async (req: WalletRequest, res: Response) => {
    try {
      const { id } = req.params;
      await markAsRead(id);
      res.status(204).send();
    } catch (err) {
      problemDetail(res, req, 500, 'Failed to mark notification as read');
    }
  },
);

router.post(
  '/notifications/read-all',
  requireWallet,
  async (req: WalletRequest, res: Response) => {
    try {
      await markAllAsRead(req.walletAddress!);
      res.status(204).send();
    } catch (err) {
      problemDetail(res, req, 500, 'Failed to mark notifications as read');
    }
  },
);

router.get(
  '/notification-preferences',
  requireWallet,
  async (req: WalletRequest, res: Response) => {
    try {
      const preferences = await getNotificationPreferences(req.walletAddress!);
      res.json(preferences);
    } catch (err) {
      problemDetail(res, req, 500, 'Failed to fetch notification preferences');
    }
  },
);

router.put(
  '/notification-preferences',
  requireWallet,
  validateBody(PreferencesSchema),
  async (req: WalletRequest, res: Response) => {
    try {
      await updateNotificationPreferences(req.walletAddress!, req.body as Record<string, boolean>);
      res.status(204).send();
    } catch (err) {
      problemDetail(res, req, 500, 'Failed to update notification preferences');
    }
  },
);

export default router;
