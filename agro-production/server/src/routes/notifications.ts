import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  validateQuery,
  validateBody,
  validateParams,
} from '../middleware/validate.js';
import { uuidParam } from '../schemas/common.js';
import { problemDetail } from '../middleware/errors.js';
import { requireWallet, type WalletRequest } from '../middleware/walletAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
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

const NotificationIdParamSchema = z.object({
  id: uuidParam,
});

const PreferencesSchema = z.record(z.string(), z.boolean());

router.get(
  '/notifications',
  requireWallet,
  validateQuery(ListQuerySchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    try {
      const { limit, unreadOnly } = req.query as Record<string, unknown>;
      const notifications = await listNotifications(req.walletAddress!, {
        limit: limit as number | undefined,
        unreadOnly: unreadOnly as boolean | undefined,
      });
      res.json(notifications);
    } catch {
      problemDetail(res, req, 500, 'Failed to fetch notifications');
    }
  }),
);

router.patch(
  '/notifications/:id/read',
  requireWallet,
  validateParams(NotificationIdParamSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    try {
      const { id } = req.params;
      const updated = await markAsRead(id, req.walletAddress);
      if (!updated) {
        problemDetail(res, req, 404, 'Not Found', 'Notification not found');
        return;
      }
      res.status(204).send();
    } catch {
      problemDetail(res, req, 500, 'Failed to mark notification as read');
    }
  }),
);

router.post(
  '/notifications/read-all',
  requireWallet,
  asyncHandler(async (req: WalletRequest, res: Response) => {
    try {
      await markAllAsRead(req.walletAddress!);
      res.status(204).send();
    } catch {
      problemDetail(res, req, 500, 'Failed to mark notifications as read');
    }
  }),
);

router.get(
  '/notification-preferences',
  requireWallet,
  asyncHandler(async (req: WalletRequest, res: Response) => {
    try {
      const preferences = await getNotificationPreferences(req.walletAddress!);
      res.json(preferences);
    } catch {
      problemDetail(res, req, 500, 'Failed to fetch notification preferences');
    }
  }),
);

router.put(
  '/notification-preferences',
  requireWallet,
  validateBody(PreferencesSchema),
  asyncHandler(async (req: WalletRequest, res: Response) => {
    try {
      await updateNotificationPreferences(
        req.walletAddress!,
        req.body as Record<string, boolean>,
      );
      res.status(204).send();
    } catch {
      problemDetail(res, req, 500, 'Failed to update notification preferences');
    }
  }),
);

export default router;
