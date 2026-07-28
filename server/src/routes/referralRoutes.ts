import express from "express";
import type { Request, Response, NextFunction } from "express";
import { requireWallet, type WalletRequest } from "../middleware/walletAuth.js";
import { requireAdmin, type AdminRequest } from "../middleware/adminAuth.js";
import { ApiError, sendProblem } from "../http/errors.js";
import logger from "../config/logger.js";
import { ReferralService } from "../services/referralService.js";

const router = express.Router();

// GET /referrals/me — fetch (or lazily create) the caller's referral code.
router.get("/referrals/me", requireWallet, async (req: WalletRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.walletAddress) {
      throw new ApiError(401, "Unauthorized", "Missing wallet", "https://cylos.io/errors/unauthorized");
    }
    const code = await ReferralService.getOrCreateCode(req.walletAddress);
    const balance = await ReferralService.getFeeCreditBalance(req.walletAddress);
    res.status(200).json({ ...code, feeCreditBalance: balance });
  } catch (error) {
    next(error);
  }
});

// GET /referrals/me/cohort — the caller's own referral cohort performance.
router.get("/referrals/me/cohort", requireWallet, async (req: WalletRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.walletAddress) {
      throw new ApiError(401, "Unauthorized", "Missing wallet", "https://cylos.io/errors/unauthorized");
    }
    const [performance, referrals] = await Promise.all([
      ReferralService.getCohortPerformance(req.walletAddress),
      ReferralService.listReferralsByReferrer(req.walletAddress),
    ]);
    res.status(200).json({ performance, referrals });
  } catch (error) {
    next(error);
  }
});

// POST /referrals/signup — link a new wallet to a referrer's code. Called
// during onboarding once the new wallet has authenticated.
router.post("/referrals/signup", requireWallet, async (req: WalletRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.walletAddress) {
      throw new ApiError(401, "Unauthorized", "Missing wallet", "https://cylos.io/errors/unauthorized");
    }
    const { referralCode } = req.body as { referralCode?: string };
    if (!referralCode) {
      throw new ApiError(400, "Bad Request", "referralCode is required");
    }
    const referral = await ReferralService.recordSignup(req.walletAddress, referralCode);
    if (!referral) {
      // Self-referral: accepted but not linked.
      res.status(200).json({ linked: false });
      return;
    }
    res.status(201).json({ linked: true, referral });
  } catch (error) {
    next(error);
  }
});

// GET /admin/referrals/cohort — org-wide referral performance for
// admins/NGOs (Issue #661 acceptance criteria: admin/NGO-facing view).
router.get("/admin/referrals/cohort", requireAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const referrerWallet = typeof req.query["referrerWallet"] === "string" ? req.query["referrerWallet"] : undefined;
    const performance = await ReferralService.getCohortPerformance(referrerWallet);
    res.status(200).json(performance);
  } catch (error) {
    next(error);
  }
});

// GET /admin/referrals/:referrerWallet — per-referrer breakdown for admins.
router.get(
  "/admin/referrals/:referrerWallet",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const referrals = await ReferralService.listReferralsByReferrer(req.params["referrerWallet"] ?? "");
      res.status(200).json(referrals);
    } catch (error) {
      next(error);
    }
  },
);

export function referralErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    sendProblem(res, req, err);
    return;
  }
  logger.error("[referralRoutes] Unhandled error", err);
  res.status(500).json({ message: "Internal server error" });
}

export default router;
