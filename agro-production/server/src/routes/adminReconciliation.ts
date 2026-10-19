import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../db/client.js";
import { runProductionReconciliation, reconcileSingleCampaign } from "../services/reconciliationService.js";
import { requireRole, type RoleRequest } from "../middleware/requireRole.js";
import { requireWallet } from "../middleware/walletAuth.js";
import logger from "../config/logger.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = Router();

// Admin routes require a verified session and the ADMIN role (Issue #1206).
// Scoped to /admin so this router, mounted at /api/v1, does not intercept
// requests meant for routers mounted after it.
router.use("/admin", requireWallet, requireRole("ADMIN"));

// Helper to log admin actions
async function logAdminAction(
  actorAddress: string,
  action: string,
  resourceType?: string,
  resourceId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorAddress,
        action,
        resourceType,
        resourceId,
        details: details ?? {},
      },
    });
  } catch (err) {
    logger.warn("[AdminAuditLog] Failed to log action", err);
  }
}

// GET /api/v1/admin/reconciliation/alerts — list reconciliation alerts
router.get("/admin/reconciliation/alerts", asyncHandler(async (req: Request, res: Response) => {
  const adminWallet = (req as RoleRequest).walletAddress!;

  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
    const resolved = req.query.resolved;
    const entityType = req.query.entityType as string | undefined;
    const driftType = req.query.driftType as string | undefined;

    const where: Record<string, unknown> = {};
    if (resolved === "true") where.resolvedAt = { not: null };
    if (resolved === "false") where.resolvedAt = null;
    if (entityType) where.entityType = entityType;
    if (driftType) where.driftType = driftType;

    const [alerts, total] = await Promise.all([
      prisma.reconciliationAlert.findMany({
        where,
        orderBy: { detectedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.reconciliationAlert.count({ where }),
    ]);

    res.json({
      data: alerts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("[Admin/Reconciliation] Failed to list alerts", err);
    res.status(500).json({ message: "Internal server error" });
  }
}));

// GET /api/v1/admin/reconciliation/alerts/:id — get a single alert
router.get("/admin/reconciliation/alerts/:id", asyncHandler(async (req: Request, res: Response) => {
  const adminWallet = (req as RoleRequest).walletAddress!;

  try {
    const alert = await prisma.reconciliationAlert.findUnique({
      where: { id: req.params.id },
    });
    if (!alert) {
      res.status(404).json({ message: "Alert not found" });
      return;
    }
    res.json(alert);
  } catch (err) {
    logger.error("[Admin/Reconciliation] Failed to get alert", err);
    res.status(500).json({ message: "Internal server error" });
  }
}));

// POST /api/v1/admin/reconciliation/alerts/:id/resolve — mark alert as resolved
router.post("/admin/reconciliation/alerts/:id/resolve", asyncHandler(async (req: Request, res: Response) => {
  const adminWallet = (req as RoleRequest).walletAddress!;

  try {
    const alert = await prisma.reconciliationAlert.findUnique({
      where: { id: req.params.id },
    });
    if (!alert) {
      res.status(404).json({ message: "Alert not found" });
      return;
    }
    if (alert.resolvedAt) {
      res.status(409).json({ message: "Alert already resolved" });
      return;
    }

    const updated = await prisma.reconciliationAlert.update({
      where: { id: req.params.id },
      data: {
        resolvedAt: new Date(),
        resolvedBy: adminWallet,
        notes: (req.body as { notes?: string }).notes ?? null,
      },
    });

    await logAdminAction(adminWallet, "alert_resolved", "reconciliation_alert", req.params.id);
    res.json(updated);
  } catch (err) {
    logger.error("[Admin/Reconciliation] Failed to resolve alert", err);
    res.status(500).json({ message: "Internal server error" });
  }
}));

// POST /api/v1/admin/reconciliation/run — trigger manual reconciliation
router.post("/admin/reconciliation/run", asyncHandler(async (req: Request, res: Response) => {
  const adminWallet = (req as RoleRequest).walletAddress!;

  try {
    const report = await runProductionReconciliation();
    await logAdminAction(adminWallet, "reconciliation_run");
    res.json(report);
  } catch (err) {
    logger.error("[Admin/Reconciliation] Manual run failed", err);
    res.status(500).json({ message: "Reconciliation run failed" });
  }
}));

// POST /api/v1/admin/reconciliation/reconcile-campaign/:campaignId — force reconcile a campaign
router.post("/admin/reconciliation/reconcile-campaign/:campaignId", asyncHandler(async (req: Request, res: Response) => {
  const adminWallet = (req as RoleRequest).walletAddress!;

  try {
    const findings = await reconcileSingleCampaign(req.params.campaignId);
    await logAdminAction(adminWallet, "campaign_reconcile", "campaign", req.params.campaignId, {
      driftDetected: findings.length > 0,
    });
    res.json({ campaignId: req.params.campaignId, findings, driftDetected: findings.length > 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      res.status(404).json({ message });
      return;
    }
    logger.error("[Admin/Reconciliation] Force reconcile failed", err);
    res.status(500).json({ message: "Force reconcile failed" });
  }
}));

// GET /api/v1/admin/reconciliation/summary — reconciliation summary stats
router.get("/admin/reconciliation/summary", asyncHandler(async (req: Request, res: Response) => {
  const adminWallet = (req as RoleRequest).walletAddress!;

  try {
    const [totalAlerts, unresolvedAlerts, recentAlerts] = await Promise.all([
      prisma.reconciliationAlert.count(),
      prisma.reconciliationAlert.count({ where: { resolvedAt: null } }),
      prisma.reconciliationAlert.findMany({
        orderBy: { detectedAt: "desc" },
        take: 10,
      }),
    ]);

    const driftsByType = await prisma.reconciliationAlert.groupBy({
      by: ["driftType"],
      where: { resolvedAt: null },
      _count: { id: true },
    });

    res.json({
      totalAlerts,
      unresolvedAlerts,
      driftsByType: driftsByType.map((d) => ({
        driftType: d.driftType,
        count: d._count.id,
      })),
      recentAlerts,
    });
  } catch (err) {
    logger.error("[Admin/Reconciliation] Failed to get summary", err);
    res.status(500).json({ message: "Internal server error" });
  }
}));

export default router;
