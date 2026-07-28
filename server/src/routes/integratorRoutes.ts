import express from "express";
import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import {
  requireIntegratorApiKey,
  recordIntegratorUsage,
  type IntegratorRequest,
} from "../middleware/integratorAuth.js";
import { requireAdmin, type AdminRequest } from "../middleware/adminAuth.js";
import { ApiError, sendProblem } from "../http/errors.js";
import logger from "../config/logger.js";
import { IntegratorService, toCsv, ensureNotOverPageLimit } from "../services/integratorService.js";

const router = express.Router();

const isTest = process.env["NODE_ENV"] === "test";

// Rate-limited per Issue #662 acceptance criteria (aggregated, rate-limited data).
const integratorRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => isTest,
  handler: (req: Request, res: Response) => {
    res.status(429).json({ message: "Rate limit exceeded for integrator API." });
  },
});

function respond(
  req: Request,
  res: Response,
  rows: Array<Record<string, unknown>>,
  endpointLabel: string,
): void {
  const format = typeof req.query["format"] === "string" ? req.query["format"] : "json";
  if (format === "csv") {
    res.status(200).type("text/csv").send(toCsv(rows));
  } else {
    res.status(200).json({ data: rows, count: rows.length });
  }
  recordIntegratorUsage(req as IntegratorRequest, res, endpointLabel);
}

// GET /integrator/v1/reports/farmers
router.get(
  "/integrator/v1/reports/farmers",
  integratorRateLimiter,
  requireIntegratorApiKey,
  async (req: IntegratorRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.integratorScope) {
        throw new ApiError(401, "Unauthorized", "Missing integrator scope");
      }
      const limit = Number(req.query["limit"] ?? 100);
      ensureNotOverPageLimit(limit);
      const rows = await IntegratorService.getFarmerReport(req.integratorScope);
      respond(req, res, rows.slice(0, limit), "/integrator/v1/reports/farmers");
    } catch (error) {
      next(error);
    }
  },
);

// GET /integrator/v1/reports/orders
router.get(
  "/integrator/v1/reports/orders",
  integratorRateLimiter,
  requireIntegratorApiKey,
  async (req: IntegratorRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.integratorScope) {
        throw new ApiError(401, "Unauthorized", "Missing integrator scope");
      }
      const limit = Number(req.query["limit"] ?? 100);
      ensureNotOverPageLimit(limit);
      const rows = await IntegratorService.getOrderReport(req.integratorScope);
      respond(req, res, rows.slice(0, limit), "/integrator/v1/reports/orders");
    } catch (error) {
      next(error);
    }
  },
);

// ── Admin-facing API key management ────────────────────────────────────────

// POST /admin/integrator/keys — issue a new scoped API key.
router.post("/admin/integrator/keys", requireAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const { organizationName, scopedFarmerWallets, scopedRegion } = req.body as {
      organizationName?: string;
      scopedFarmerWallets?: string[];
      scopedRegion?: string;
    };
    if (!organizationName) {
      throw new ApiError(400, "Bad Request", "organizationName is required");
    }
    const key = await IntegratorService.issueKey({
      organizationName,
      scopedFarmerWallets,
      scopedRegion,
      createdByAdmin: req.adminWallet ?? "unknown",
    });
    res.status(201).json(key);
  } catch (error) {
    next(error);
  }
});

// GET /admin/integrator/keys — list keys (optionally filtered by organization).
router.get("/admin/integrator/keys", requireAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const organizationName =
      typeof req.query["organizationName"] === "string" ? req.query["organizationName"] : undefined;
    const keys = await IntegratorService.listKeys(organizationName);
    res.status(200).json(keys);
  } catch (error) {
    next(error);
  }
});

// DELETE /admin/integrator/keys/:keyId — revoke a compromised/expired key.
router.delete(
  "/admin/integrator/keys/:keyId",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const revoked = await IntegratorService.revokeKey(req.params["keyId"] ?? "");
      res.status(200).json(revoked);
    } catch (error) {
      next(error);
    }
  },
);

// GET /admin/integrator/keys/:keyId/usage — audit log of key usage.
router.get(
  "/admin/integrator/keys/:keyId/usage",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query["limit"] ?? 100);
      const usage = await IntegratorService.getUsageLog(req.params["keyId"] ?? "", limit);
      res.status(200).json(usage);
    } catch (error) {
      next(error);
    }
  },
);

export function integratorErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    sendProblem(res, req, err);
    return;
  }
  logger.error("[integratorRoutes] Unhandled error", err);
  res.status(500).json({ message: "Internal server error" });
}

export default router;
