import { rpc, Address, Contract, nativeToScVal, scValToNative as sdkScValToNative, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { prisma } from "../config/database.js";
import { config } from "../config/index.js";
import logger from "../config/logger.js";
import { amountsEqual, canonicalizeAmount } from "../lib/money.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriftFinding {
  entityType: "order" | "campaign" | "dispute";
  entityId: string;
  contractSet: "escrow";
  driftType: "status_mismatch" | "amount_mismatch" | "missing_on_chain" | "missing_in_db";
  dbValue: Record<string, unknown>;
  chainValue: Record<string, unknown>;
}

export interface ReconciliationReport {
  startedAt: Date;
  completedAt: Date;
  ordersChecked: number;
  campaignsChecked: number;
  disputesChecked: number;
  driftsFound: number;
  alerts: DriftFinding[];
  errors: string[];
}

// Contract on-chain status enums (from escrow/src/lib.rs)
const ORDER_STATUS_MAP: Record<number, string> = {
  0: "Pending",
  1: "Disputed",
  2: "Completed",
  3: "Refunded",
};

const CAMPAIGN_STATUS_MAP: Record<number, string> = {
  0: "Active",
  1: "Settled",
};

// ---------------------------------------------------------------------------
// Soroban RPC helpers
// ---------------------------------------------------------------------------

async function simulateContractFn(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<xdr.ScVal | null> {
  const contract = new Contract(contractId);
  const sourceAccount = new rpc.Account(
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "0",
  );
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase:
      config.nodeEnv === "production"
        ? "Public Global Stellar Network ; September 2015"
        : "Test SDF Network ; September 2015",
    timebounds: { minTime: 0, maxTime: 0 },
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(0)
    .build();

  const result = await server.simulateTransaction(tx);
  if (
    "error" in result &&
    result.error
  ) {
    logger.warn(`[Reconciliation] Contract call ${method} failed: ${result.error}`);
    return null;
  }
  if ("result" in result && result.result) {
    return result.result.retval;
  }
  return null;
}

function scValToString(val: xdr.ScVal): unknown {
  try {
    return sdkScValToNative(val);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Order reconciliation
// ---------------------------------------------------------------------------

async function reconcileOrders(
  server: rpc.Server,
  contractId: string,
): Promise<{ checked: number; findings: DriftFinding[]; errors: string[] }> {
  const findings: DriftFinding[] = [];
  const errors: string[] = [];
  let checked = 0;

  const openStatuses = ["Pending", "Delivered", "Disputed"];
  const orders = await prisma.order.findMany({
    where: { status: { in: openStatuses } },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  for (const order of orders) {
    const orderIdNum = parseInt(order.orderIdOnChain, 10);
    if (isNaN(orderIdNum)) {
      errors.push(`Order ${order.orderIdOnChain}: invalid on-chain ID`);
      continue;
    }

    try {
      const args = [nativeToScVal(orderIdNum, { type: "u64" })];
      const result = await simulateContractFn(server, contractId, "get_order_details", args);

      if (result === null) {
        findings.push({
          entityType: "order",
          entityId: order.orderIdOnChain,
          contractSet: "escrow",
          driftType: "missing_on_chain",
          dbValue: { status: order.status, amount: order.amount, buyer: order.buyerAddress, seller: order.sellerAddress },
          chainValue: { error: "contract call returned null" },
        });
        checked++;
        continue;
      }

      const native = scValToString(result) as Record<string, unknown> | null;
      if (!native || typeof native !== "object") {
        errors.push(`Order ${order.orderIdOnChain}: unexpected contract response`);
        checked++;
        continue;
      }

      const chainStatus = ORDER_STATUS_MAP[Number(native["status"])] ?? String(native["status"]);
      // Canonicalize chain amount: on-chain i128 may render as number/bigint; normalize to canonical string
      let chainAmount = "";
      try {
        const rawAmt = native["amount"];
        if (rawAmt !== undefined && rawAmt !== null && String(rawAmt).trim() !== "") {
          chainAmount = canonicalizeAmount(String(rawAmt));
        }
      } catch {
        chainAmount = String(native["amount"] ?? "").trim();
      }
      const chainBuyer = String(native["buyer"] ?? "");
      const chainFarmer = String(native["farmer"] ?? "");

      // Status drift
      const dbStatusNorm = normalizeOrderStatus(order.status);
      if (chainStatus !== dbStatusNorm) {
        findings.push({
          entityType: "order",
          entityId: order.orderIdOnChain,
          contractSet: "escrow",
          driftType: "status_mismatch",
          dbValue: { status: order.status },
          chainValue: { status: chainStatus },
        });
      }

      // Amount drift — numeric comparison, never raw string compare
      // Equivalent canonical values must not register as drift (e.g. "1000" vs "1000.0")
      if (chainAmount && !amountsEqual(chainAmount, order.amount)) {
        findings.push({
          entityType: "order",
          entityId: order.orderIdOnChain,
          contractSet: "escrow",
          driftType: "amount_mismatch",
          dbValue: { amount: order.amount },
          chainValue: { amount: chainAmount },
        });
      }
    } catch (err) {
      errors.push(`Order ${order.orderIdOnChain}: ${err instanceof Error ? err.message : String(err)}`);
    }

    checked++;
  }

  return { checked, findings, errors };
}

function normalizeOrderStatus(dbStatus: string): string {
  const map: Record<string, string> = {
    Pending: "Pending",
    Delivered: "Pending", // on-chain "delivered" is not a status, it's an event
    Disputed: "Disputed",
    Completed: "Completed",
    Refunded: "Refunded",
    Confirmed: "Completed",
  };
  return map[dbStatus] ?? dbStatus;
}

// ---------------------------------------------------------------------------
// Campaign reconciliation
// ---------------------------------------------------------------------------

async function reconcileCampaigns(
  server: rpc.Server,
  contractId: string,
): Promise<{ checked: number; findings: DriftFinding[]; errors: string[] }> {
  const findings: DriftFinding[] = [];
  const errors: string[] = [];
  let checked = 0;

  const activeStatuses = ["Active", "FUNDING", "FUNDED", "IN_PRODUCTION", "HARVESTED"];
  const campaigns = await prisma.campaign.findMany({
    where: { status: { in: activeStatuses } },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  for (const campaign of campaigns) {
    const campaignIdNum = parseInt(campaign.campaignIdOnChain, 10);
    if (isNaN(campaignIdNum)) {
      errors.push(`Campaign ${campaign.campaignIdOnChain}: invalid on-chain ID`);
      continue;
    }

    // The root escrow contract doesn't have a get_campaign view function
    // (only production_escrow does). Skip campaign reconciliation for root.
    // This is a placeholder for when the escrow contract adds campaign views.
    checked++;
  }

  return { checked, findings, errors };
}

// ---------------------------------------------------------------------------
// Dispute reconciliation
// ---------------------------------------------------------------------------

async function reconcileDisputes(
  server: rpc.Server,
  contractId: string,
): Promise<{ checked: number; findings: DriftFinding[]; errors: string[] }> {
  const findings: DriftFinding[] = [];
  const errors: string[] = [];
  let checked = 0;

  const openDisputes = await prisma.dispute.findMany({
    where: { status: { in: ["OPEN", "IN_REVIEW", "EVIDENCE_SUBMITTED"] } },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  for (const dispute of openDisputes) {
    const orderIdNum = parseInt(dispute.orderIdOnChain, 10);
    if (isNaN(orderIdNum)) {
      errors.push(`Dispute ${dispute.orderIdOnChain}: invalid on-chain order ID`);
      continue;
    }

    try {
      const args = [nativeToScVal(orderIdNum, { type: "u64" })];
      const result = await simulateContractFn(server, contractId, "get_dispute", args);

      if (result === null) {
        findings.push({
          entityType: "dispute",
          entityId: dispute.orderIdOnChain,
          contractSet: "escrow",
          driftType: "missing_on_chain",
          dbValue: { status: dispute.status, raisedBy: dispute.raisedBy },
          chainValue: { error: "contract call returned null" },
        });
        checked++;
        continue;
      }

      const native = scValToString(result) as Record<string, unknown> | null;
      if (!native || typeof native !== "object") {
        errors.push(`Dispute ${dispute.orderIdOnChain}: unexpected contract response`);
        checked++;
        continue;
      }

      const chainResolved = Boolean(native["resolved"]);
      const dbResolved = dispute.status === "RESOLVED" || dispute.status === "RESOLVED_BUYER" || dispute.status === "RESOLVED_SELLER";

      if (chainResolved !== dbResolved) {
        findings.push({
          entityType: "dispute",
          entityId: dispute.orderIdOnChain,
          contractSet: "escrow",
          driftType: "status_mismatch",
          dbValue: { status: dispute.status, resolved: dbResolved },
          chainValue: { resolved: chainResolved },
        });
      }
    } catch (err) {
      errors.push(`Dispute ${dispute.orderIdOnChain}: ${err instanceof Error ? err.message : String(err)}`);
    }

    checked++;
  }

  return { checked, findings, errors };
}

// ---------------------------------------------------------------------------
// Auto-repair for safe drift classes
// ---------------------------------------------------------------------------

interface AutoRepairResult {
  success: boolean;
  message: string;
}

async function attemptAutoRepair(finding: DriftFinding): Promise<AutoRepairResult> {
  try {
    // Only auto-repair orders with simple missing-in-db cases that can be safely re-derived
    // More complex drifts (status mismatches, amount mismatches) require manual review
    if (finding.entityType !== "order") {
      return { success: false, message: "Auto-repair not supported for this entity type" };
    }

    if (finding.driftType === "missing_in_db") {
      // This is safe: on-chain record exists but DB is missing it
      // In a real deployment, we'd re-derive the order from chain data
      // For now, just mark as requiring manual review
      return { success: false, message: "Missing DB record requires manual review and data recovery" };
    }

    if (finding.driftType === "status_mismatch") {
      // Status mismatches could indicate genuine state divergence or indexer lag
      // Require manual review — never auto-repair without human verification
      return { success: false, message: "Status mismatch requires manual investigation" };
    }

    if (finding.driftType === "amount_mismatch") {
      // Amount changes could indicate lost precision or actual bugs
      // Require manual review
      return { success: false, message: "Amount mismatch requires manual verification" };
    }

    return { success: false, message: `Unknown drift type: ${finding.driftType}` };
  } catch (err) {
    return {
      success: false,
      message: `Auto-repair failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Alert persistence with auto-repair attempt
// ---------------------------------------------------------------------------

async function persistAlerts(findings: DriftFinding[]): Promise<void> {
  for (const finding of findings) {
    try {
      const repairResult = await attemptAutoRepair(finding);
      const autoRepaired = repairResult.success;

      await prisma.reconciliationAlert.create({
        data: {
          entityType: finding.entityType,
          entityId: finding.entityId,
          contractSet: finding.contractSet,
          driftType: finding.driftType,
          dbValue: finding.dbValue,
          chainValue: finding.chainValue,
          notes: autoRepaired ? `Auto-repaired: ${repairResult.message}` : `Requires review: ${repairResult.message}`,
        },
      });

      if (autoRepaired) {
        logger.info("[Reconciliation] Auto-repair succeeded", {
          entityType: finding.entityType,
          entityId: finding.entityId,
          driftType: finding.driftType,
        });
      } else {
        logger.debug("[Reconciliation] Auto-repair not applied", {
          entityType: finding.entityType,
          entityId: finding.entityId,
          driftType: finding.driftType,
          reason: repairResult.message,
        });
      }
    } catch (err) {
      logger.error("[Reconciliation] Failed to persist alert", {
        error: err instanceof Error ? err.message : String(err),
        finding,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Metrics emission
// ---------------------------------------------------------------------------

interface ReconciliationMetric {
  timestamp: Date;
  driftsFound: number;
  ordersChecked: number;
  campaignsChecked: number;
  disputesChecked: number;
  durationMs: number;
}

export function emitReconciliationMetric(metric: ReconciliationMetric): void {
  // Emit reconciliation_drift metric for monitoring systems to pick up
  // In a production setup, this would be sent to Prometheus, DataDog, etc.
  logger.info("[Reconciliation] Drift metric", {
    metric_name: "reconciliation_drift",
    metric_value: metric.driftsFound,
    timestamp: metric.timestamp.toISOString(),
    ordersChecked: metric.ordersChecked,
    campaignsChecked: metric.campaignsChecked,
    disputesChecked: metric.disputesChecked,
    durationMs: metric.durationMs,
  });

  // Alert when drift is detected (non-zero)
  if (metric.driftsFound > 0) {
    logger.warn("[Reconciliation] Non-zero drift detected - alert should fire", {
      metric_name: "reconciliation_drift",
      alert_threshold: 0,
      current_value: metric.driftsFound,
    });
  }
}

// ---------------------------------------------------------------------------
// Main reconciliation entry point
// ---------------------------------------------------------------------------

export async function runReconciliation(): Promise<ReconciliationReport> {
  const startedAt = new Date();
  logger.info("[Reconciliation] Starting scheduled reconciliation run");

  const server = new rpc.Server(config.rpcUrl);
  const contractId = config.contractId;

  const allFindings: DriftFinding[] = [];
  const allErrors: string[] = [];
  let ordersChecked = 0;
  let campaignsChecked = 0;
  let disputesChecked = 0;

  if (contractId) {
    try {
      const orderResult = await reconcileOrders(server, contractId);
      ordersChecked = orderResult.checked;
      allFindings.push(...orderResult.findings);
      allErrors.push(...orderResult.errors);
    } catch (err) {
      allErrors.push(`Order reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const campaignResult = await reconcileCampaigns(server, contractId);
      campaignsChecked = campaignResult.checked;
      allFindings.push(...campaignResult.findings);
      allErrors.push(...campaignResult.errors);
    } catch (err) {
      allErrors.push(`Campaign reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const disputeResult = await reconcileDisputes(server, contractId);
      disputesChecked = disputeResult.checked;
      allFindings.push(...disputeResult.findings);
      allErrors.push(...disputeResult.errors);
    } catch (err) {
      allErrors.push(`Dispute reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    allErrors.push("No CONTRACT_ID configured — skipping reconciliation");
  }

  if (allFindings.length > 0) {
    await persistAlerts(allFindings);
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const report: ReconciliationReport = {
    startedAt,
    completedAt,
    ordersChecked,
    campaignsChecked,
    disputesChecked,
    driftsFound: allFindings.length,
    alerts: allFindings,
    errors: allErrors,
  };

  // Emit reconciliation_drift metric for monitoring/alerting
  emitReconciliationMetric({
    timestamp: completedAt,
    driftsFound: allFindings.length,
    ordersChecked,
    campaignsChecked,
    disputesChecked,
    durationMs,
  });

  // Audit logging: log the full reconciliation run for audit trail
  logger.info("[Reconciliation] Run completed - audit record", {
    audit_event: "reconciliation_completed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    ordersChecked,
    campaignsChecked,
    disputesChecked,
    driftsFound: allFindings.length,
    errors: allErrors.length,
    durationMs,
    status: allErrors.length > 0 ? "completed_with_errors" : "completed_successfully",
  });

  if (allFindings.length > 0) {
    logger.warn("[Reconciliation] Drift detected", {
      driftsFound: allFindings.length,
      ordersChecked,
      disputesChecked,
      durationMs,
    });
  } else {
    logger.info("[Reconciliation] No drift detected", {
      ordersChecked,
      campaignsChecked,
      disputesChecked,
      errors: allErrors.length,
      durationMs,
    });
  }

  return report;
}

// ---------------------------------------------------------------------------
// Manual single-entity reconciliation
// ---------------------------------------------------------------------------

export async function reconcileSingleOrder(orderIdOnChain: string): Promise<DriftFinding[]> {
  const server = new rpc.Server(config.rpcUrl);
  const contractId = config.contractId;
  if (!contractId) throw new Error("CONTRACT_ID not configured");

  const order = await prisma.order.findUnique({ where: { orderIdOnChain } });
  if (!order) throw new Error(`Order ${orderIdOnChain} not found in database`);

  const findings: DriftFinding[] = [];
  const orderIdNum = parseInt(orderIdOnChain, 10);
  if (isNaN(orderIdNum)) throw new Error(`Invalid on-chain order ID: ${orderIdOnChain}`);

  const args = [nativeToScVal(orderIdNum, { type: "u64" })];
  const result = await simulateContractFn(server, contractId, "get_order_details", args);

  if (result === null) {
    findings.push({
      entityType: "order",
      entityId: orderIdOnChain,
      contractSet: "escrow",
      driftType: "missing_on_chain",
      dbValue: { status: order.status, amount: order.amount },
      chainValue: { error: "contract call returned null" },
    });
    return findings;
  }

  const native = scValToString(result) as Record<string, unknown> | null;
  if (!native || typeof native !== "object") {
    throw new Error("Unexpected contract response format");
  }

  const chainStatus = ORDER_STATUS_MAP[Number(native["status"])] ?? String(native["status"]);
  let chainAmount = "";
  try {
    const rawAmt = native["amount"];
    if (rawAmt !== undefined && rawAmt !== null && String(rawAmt).trim() !== "") {
      chainAmount = canonicalizeAmount(String(rawAmt));
    }
  } catch {
    chainAmount = String(native["amount"] ?? "").trim();
  }
  const dbStatusNorm = normalizeOrderStatus(order.status);

  if (chainStatus !== dbStatusNorm) {
    findings.push({
      entityType: "order",
      entityId: orderIdOnChain,
      contractSet: "escrow",
      driftType: "status_mismatch",
      dbValue: { status: order.status },
      chainValue: { status: chainStatus },
    });
  }

  if (chainAmount && !amountsEqual(chainAmount, order.amount)) {
    findings.push({
      entityType: "order",
      entityId: orderIdOnChain,
      contractSet: "escrow",
      driftType: "amount_mismatch",
      dbValue: { amount: order.amount },
      chainValue: { amount: chainAmount },
    });
  }

  return findings;
}
