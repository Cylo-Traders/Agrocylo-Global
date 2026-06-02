import express from "express";
import { z } from "zod";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import { ApiError, sendProblem } from "../http/errors.js";
import {
  listNotifications,
  markNotificationsRead,
} from "../services/notificationService.js";
import {
  getNotificationPreferences,
  notificationPrefsSchema,
  upsertNotificationPreferences,
} from "../services/notificationPreferenceService.js";

const router = express.Router();

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

router.get(
  "/notifications/preferences",
  requireWallet,
  async (req: WalletRequest, res, next) => {
    try {
      if (!req.walletAddress) {
        throw new ApiError(401, "Unauthorized", "Missing wallet");
      }

      const preferences = await getNotificationPreferences(req.walletAddress);
      res.status(200).json({ preferences });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  "/notifications/preferences",
  requireWallet,
  async (req: WalletRequest, res, next) => {
    try {
      if (!req.walletAddress) {
        throw new ApiError(401, "Unauthorized", "Missing wallet");
      }

      const parsed = notificationPrefsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiError(400, "Bad Request", parsed.error.message);
      }

      const preferences = await upsertNotificationPreferences(
        req.walletAddress,
        parsed.data,
      );
      res.status(200).json({ preferences });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/notifications",
  requireWallet,
  async (req: WalletRequest, res, next) => {
    try {
      if (!req.walletAddress) {
        throw new ApiError(401, "Unauthorized", "Missing wallet");
      }

      const unreadOnlyParam = req.query["unread_only"];
      const limitParam = req.query["limit"];

      const unreadOnly =
        typeof unreadOnlyParam === "string"
          ? unreadOnlyParam !== "false" && unreadOnlyParam !== "0"
          : true;
      const limit =
        typeof limitParam === "string" ? Number.parseInt(limitParam, 10) : undefined;

      const items = await listNotifications(req.walletAddress, {
        unreadOnly,
        limit,
      });

      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/notifications/:id/read",
  requireWallet,
  async (req: WalletRequest, res, next) => {
    try {
      if (!req.walletAddress) {
        throw new ApiError(401, "Unauthorized", "Missing wallet");
      }

      const notificationId = String(req.params["id"] ?? "");
      if (!notificationId) {
        throw new ApiError(400, "Bad Request", "Missing notification id");
      }

      await markNotificationsRead(req.walletAddress, [notificationId]);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/notifications/read",
  requireWallet,
  async (req: WalletRequest, res, next) => {
    try {
      if (!req.walletAddress) {
        throw new ApiError(401, "Unauthorized", "Missing wallet");
      }

      const parsed = markReadSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiError(400, "Bad Request", parsed.error.message);
      }

      const result = await markNotificationsRead(req.walletAddress, parsed.data.ids);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);

export function notificationErrorHandler(
  error: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (error instanceof ApiError) {
    sendProblem(res, req, error);
    return;
  }

  next(error);
}

export default router;
