import { Account, rpc, Contract, nativeToScVal, scValToNative as sdkScValToNative, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { config } from "../config/index.js";
import logger from "../config/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriftFinding {
  entityType: "campaign" | "order" | "dispute" | "basket";
  entityId: string;
  contractSet: "production_escrow" | "escrow" | "investment_basket";
  driftType: "status_mismatch" | "amount_mismatch" | "missing_on_chain" | "missing_in_db";
  dbValue: Record<string, unknown>;
  chainValue: Record<string, unknown>;
}

export interface ReconciliationReport {
  startedAt: Date;
  completedAt: Date;
  campaignsChecked: number;
  ordersChecked: number;
  disputesChecked: number;
  basketsChecked: number;
  driftsFound: number;
  alerts: DriftFinding[];
  errors: string[];
}

// Contract on-chain status enums (from production_escrow/src/lib.rs)
const CAMPAIGN_STATUS_MAP: Record<number, string> = {
  0: "Funding",
  1: "Funded",
  2: "InProduction",
  3: "Harvested",
  4: "Settled",
  5: "Failed",
  6: "Disputed",
};

const ORDER_STATUS_MAP: Record<number, string> = {
  0: "Pending",
  1: "Confirmed",
  2: "Refunded",
};

// DB status -> on-chain status normalization
const DB_TO_CHAIN_CAMPAIGN: Record<string, string> = {
  FUNDING: "Funding",
  FUNDED: "Funded",
  IN_PRODUCTION: "InProduction",
  HARVESTED: "Harvested",
  SETTLED: "Settled",
  FAILED: "Failed",
  DISPUTED: "Disputed",
};

const DB_TO_CHAIN_ORDER: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
};

// ---------------------------------------------------------------------------
// Soroban RPC helpers
// ---------------------------------------------------------------------------

function getNetworkPassphrase(): string {
  return config.nodeEnv === "production"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";
}

async function simulateContractFn(
  server: rpc.Server,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<xdr.ScVal | null> {
  const contract = new Contract(contractId);
  const sourceAccount = new Account(
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "0",
  );
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: getNetworkPassphrase(),
    timebounds: { minTime: 0, maxTime: 0 },
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(0)
    .build();

  const result = await server.simulateTransaction(tx);
  if ("error" in result && result.error) {
    logger.warn(`[ProductionReconciliation] Contract call ${method} failed: ${result.error}`);
    return null;
  }
  if ("result" in result && result.result) {
    return result.result.retval;
  }
  return null;
}

function scValToNative(val: xdr.ScVal): unknown {
  return sdkScValToNative(val);
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

  const activeStatuses = ["FUNDING", "FUNDED", "IN_PRODUCTION", "HARVESTED", "DISPUTED"];
  const campaigns = await prisma.campaign.findMany({
    where: { status: { in: activeStatuses as any[] } },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  for (const campaign of campaigns) {
    const campaignIdNum = parseInt(campaign.onChainId, 10);
    if (isNaN(campaignIdNum)) {
      errors.push(`Campaign ${campaign.onChainId}: invalid on-chain ID`);
      continue;
    }

    try {
      const args = [nativeToScVal(campaignIdNum, { type: "u64" })];
      const result = await simulateContractFn(server, contractId, "get_campaign", args);

      if (result === null) {
        findings.push({
          entityType: "campaign",
          entityId: campaign.onChainId,
          contractSet: "production_escrow",
          driftType: "missing_on_chain",
          dbValue: { status: campaign.status, totalRaised: campaign.totalRaised },
          chainValue: { error: "contract call returned null" },
        });
        checked++;
        continue;
      }

      const native = scValToNative(result) as Record<string, unknown> | null;
      if (!native || typeof native !== "object") {
        errors.push(`Campaign ${campaign.onChainId}: unexpected contract response`);
        checked++;
        continue;
      }

      const chainStatus = CAMPAIGN_STATUS_MAP[Number(native["status"])] ?? String(native["status"]);
      const chainTotalRaised = String(native["total_raised"] ?? "");
      const chainTargetAmount = String(native["target_amount"] ?? "");
      const chainTrancheReleased = String(native["tranche_released"] ?? "");

      // Status drift
      const expectedChainStatus = DB_TO_CHAIN_CAMPAIGN[campaign.status] ?? campaign.status;
      if (chainStatus !== expectedChainStatus) {
        findings.push({
          entityType: "campaign",
          entityId: campaign.onChainId,
          contractSet: "production_escrow",
          driftType: "status_mismatch",
          dbValue: { status: campaign.status },
          chainValue: { status: chainStatus },
        });
      }

      // Amount drift (totalRaised)
      if (chainTotalRaised && chainTotalRaised !== campaign.totalRaised) {
        findings.push({
          entityType: "campaign",
          entityId: campaign.onChainId,
          contractSet: "production_escrow",
          driftType: "amount_mismatch",
          dbValue: { totalRaised: campaign.totalRaised },
          chainValue: { totalRaised: chainTotalRaised },
        });
      }

      // Amount drift (trancheReleased)
      if (chainTrancheReleased && chainTrancheReleased !== campaign.trancheReleased) {
        findings.push({
          entityType: "campaign",
          entityId: campaign.onChainId,
          contractSet: "production_escrow",
          driftType: "amount_mismatch",
          dbValue: { trancheReleased: campaign.trancheReleased },
          chainValue: { trancheReleased: chainTrancheReleased },
        });
      }
    } catch (err) {
      errors.push(`Campaign ${campaign.onChainId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    checked++;
  }

  return { checked, findings, errors };
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

  const orders = await prisma.order.findMany({
    where: { status: "PENDING" },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  for (const order of orders) {
    const orderIdNum = parseInt(order.onChainId, 10);
    if (isNaN(orderIdNum)) {
      errors.push(`Order ${order.onChainId}: invalid on-chain ID`);
      continue;
    }

    try {
      const args = [nativeToScVal(orderIdNum, { type: "u64" })];
      const result = await simulateContractFn(server, contractId, "get_order", args);

      if (result === null) {
        findings.push({
          entityType: "order",
          entityId: order.onChainId,
          contractSet: "production_escrow",
          driftType: "missing_on_chain",
          dbValue: { status: order.status, amount: order.amount },
          chainValue: { error: "contract call returned null" },
        });
        checked++;
        continue;
      }

      const native = scValToNative(result) as Record<string, unknown> | null;
      if (!native || typeof native !== "object") {
        errors.push(`Order ${order.onChainId}: unexpected contract response`);
        checked++;
        continue;
      }

      const chainStatus = ORDER_STATUS_MAP[Number(native["status"])] ?? String(native["status"]);
      const chainAmount = String(native["amount"] ?? "");

      // Status drift
      const expectedChainStatus = DB_TO_CHAIN_ORDER[order.status] ?? order.status;
      if (chainStatus !== expectedChainStatus) {
        findings.push({
          entityType: "order",
          entityId: order.onChainId,
          contractSet: "production_escrow",
          driftType: "status_mismatch",
          dbValue: { status: order.status },
          chainValue: { status: chainStatus },
        });
      }

      // Amount drift
      if (chainAmount && chainAmount !== order.amount) {
        findings.push({
          entityType: "order",
          entityId: order.onChainId,
          contractSet: "production_escrow",
          driftType: "amount_mismatch",
          dbValue: { amount: order.amount },
          chainValue: { amount: chainAmount },
        });
      }
    } catch (err) {
      errors.push(`Order ${order.onChainId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    checked++;
  }

  return { checked, findings, errors };
}

// ---------------------------------------------------------------------------
// Dispute reconciliation
// ---------------------------------------------------------------------------

async function reconcileDisputes(
  _server: rpc.Server,
  _contractId: string,
): Promise<{ checked: number; findings: DriftFinding[]; errors: string[] }> {
  const findings: DriftFinding[] = [];
  const errors: string[] = [];
  let checked = 0;

  // The production_escrow contract tracks disputes at the campaign level,
  // not as separate entities. We check campaigns in DISPUTED status against
  // the DB dispute records.
  const disputedCampaigns = await prisma.campaign.findMany({
    where: { status: "DISPUTED" },
    take: 200,
  });

  for (const campaign of disputedCampaigns) {
    const dbDispute = await prisma.dispute.findFirst({
      where: { campaignId: campaign.id, status: { in: ["Open", "EvidenceSubmitted"] } },
    });

    if (!dbDispute) {
      findings.push({
        entityType: "dispute",
        entityId: campaign.onChainId,
        contractSet: "production_escrow",
        driftType: "missing_in_db",
        dbValue: { campaignStatus: campaign.status, dispute: null },
        chainValue: { campaignStatus: "Disputed" },
      });
    }

    checked++;
  }

  return { checked, findings, errors };
}

// ---------------------------------------------------------------------------
// Basket reconciliation
// ---------------------------------------------------------------------------

async function reconcileBaskets(
  server: rpc.Server,
): Promise<{ checked: number; findings: DriftFinding[]; errors: string[] }> {
  const findings: DriftFinding[] = [];
  const errors: string[] = [];
  let checked = 0;

  const basketContractId = config.basketContractId;
  if (!basketContractId) {
    return { checked: 0, findings: [], errors: ["BASKET_CONTRACT_ID not configured — skipping basket reconciliation"] };
  }

  const openBaskets = await prisma.basket.findMany({
    where: { status: "OPEN" },
    take: 100,
    orderBy: { createdAt: "desc" },
  });

  for (const basket of openBaskets) {
    const basketIdNum = parseInt(basket.onChainId, 10);
    if (isNaN(basketIdNum)) {
      errors.push(`Basket ${basket.onChainId}: invalid on-chain ID`);
      continue;
    }

    try {
      const args = [nativeToScVal(basketIdNum, { type: "u64" })];
      const result = await simulateContractFn(server, basketContractId, "get_basket", args);

      if (result === null) {
        findings.push({
          entityType: "basket",
          entityId: basket.onChainId,
          contractSet: "investment_basket",
          driftType: "missing_on_chain",
          dbValue: { status: basket.status, totalDeposited: basket.totalDeposited },
          chainValue: { error: "contract call returned null" },
        });
        checked++;
        continue;
      }

      const native = scValToNative(result) as Record<string, unknown> | null;
      if (!native || typeof native !== "object") {
        errors.push(`Basket ${basket.onChainId}: unexpected contract response`);
        checked++;
        continue;
      }

      // Basket status: 0 = Open, 1 = Funded
      const chainStatusNum = Number(native["status"]);
      const chainStatus = chainStatusNum === 0 ? "OPEN" : chainStatusNum === 1 ? "FUNDED" : String(chainStatusNum);
      const chainTotalDeposited = String(native["total_deposited"] ?? "");

      if (chainStatus !== basket.status) {
        findings.push({
          entityType: "basket",
          entityId: basket.onChainId,
          contractSet: "investment_basket",
          driftType: "status_mismatch",
          dbValue: { status: basket.status },
          chainValue: { status: chainStatus },
        });
      }

      if (chainTotalDeposited && chainTotalDeposited !== basket.totalDeposited) {
        findings.push({
          entityType: "basket",
          entityId: basket.onChainId,
          contractSet: "investment_basket",
          driftType: "amount_mismatch",
          dbValue: { totalDeposited: basket.totalDeposited },
          chainValue: { totalDeposited: chainTotalDeposited },
        });
      }
    } catch (err) {
      errors.push(`Basket ${basket.onChainId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    checked++;
  }

  return { checked, findings, errors };
}

// ---------------------------------------------------------------------------
// Alert persistence
// ---------------------------------------------------------------------------

async function persistAlerts(findings: DriftFinding[]): Promise<void> {
  for (const finding of findings) {
    try {
      await prisma.reconciliationAlert.create({
        data: {
          entityType: finding.entityType,
          entityId: finding.entityId,
          contractSet: finding.contractSet,
          driftType: finding.driftType,
          dbValue: finding.dbValue as Prisma.InputJsonObject,
          chainValue: finding.chainValue as Prisma.InputJsonObject,
        },
      });
    } catch (err) {
      logger.error("[ProductionReconciliation] Failed to persist alert", {
        error: err instanceof Error ? err.message : String(err),
        finding,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Main reconciliation entry point
// ---------------------------------------------------------------------------

export async function runProductionReconciliation(): Promise<ReconciliationReport> {
  const startedAt = new Date();
  logger.info("[ProductionReconciliation] Starting scheduled reconciliation run");

  const server = new rpc.Server(config.rpcUrl);
  const contractId = config.productionEscrowContractId || config.contractId;

  const allFindings: DriftFinding[] = [];
  const allErrors: string[] = [];
  let campaignsChecked = 0;
  let ordersChecked = 0;
  let disputesChecked = 0;
  let basketsChecked = 0;

  if (contractId) {
    try {
      const campaignResult = await reconcileCampaigns(server, contractId);
      campaignsChecked = campaignResult.checked;
      allFindings.push(...campaignResult.findings);
      allErrors.push(...campaignResult.errors);
    } catch (err) {
      allErrors.push(`Campaign reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const orderResult = await reconcileOrders(server, contractId);
      ordersChecked = orderResult.checked;
      allFindings.push(...orderResult.findings);
      allErrors.push(...orderResult.errors);
    } catch (err) {
      allErrors.push(`Order reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
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
    allErrors.push("No PRODUCTION_CONTRACT_ID configured — skipping reconciliation");
  }

  // Basket reconciliation uses a separate contract
  try {
    const basketResult = await reconcileBaskets(server);
    basketsChecked = basketResult.checked;
    allFindings.push(...basketResult.findings);
    allErrors.push(...basketResult.errors);
  } catch (err) {
    allErrors.push(`Basket reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (allFindings.length > 0) {
    await persistAlerts(allFindings);
  }

  const completedAt = new Date();
  const report: ReconciliationReport = {
    startedAt,
    completedAt,
    campaignsChecked,
    ordersChecked,
    disputesChecked,
    basketsChecked,
    driftsFound: allFindings.length,
    alerts: allFindings,
    errors: allErrors,
  };

  if (allFindings.length > 0) {
    logger.warn("[ProductionReconciliation] Drift detected", {
      driftsFound: allFindings.length,
      campaignsChecked,
      ordersChecked,
      basketsChecked,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    });
  } else {
    logger.info("[ProductionReconciliation] No drift detected", {
      campaignsChecked,
      ordersChecked,
      disputesChecked,
      basketsChecked,
      errors: allErrors.length,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    });
  }

  return report;
}

// ---------------------------------------------------------------------------
// Manual single-entity reconciliation
// ---------------------------------------------------------------------------

export async function reconcileSingleCampaign(campaignOnChainId: string): Promise<DriftFinding[]> {
  const server = new rpc.Server(config.rpcUrl);
  const contractId = config.productionEscrowContractId || config.contractId;
  if (!contractId) throw new Error("PRODUCTION_CONTRACT_ID not configured");

  const campaign = await prisma.campaign.findUnique({ where: { onChainId: campaignOnChainId } });
  if (!campaign) throw new Error(`Campaign ${campaignOnChainId} not found in database`);

  const findings: DriftFinding[] = [];
  const campaignIdNum = parseInt(campaignOnChainId, 10);
  if (isNaN(campaignIdNum)) throw new Error(`Invalid on-chain campaign ID: ${campaignOnChainId}`);

  const args = [nativeToScVal(campaignIdNum, { type: "u64" })];
  const result = await simulateContractFn(server, contractId, "get_campaign", args);

  if (result === null) {
    findings.push({
      entityType: "campaign",
      entityId: campaignOnChainId,
      contractSet: "production_escrow",
      driftType: "missing_on_chain",
      dbValue: { status: campaign.status, totalRaised: campaign.totalRaised },
      chainValue: { error: "contract call returned null" },
    });
    return findings;
  }

  const native = scValToNative(result) as Record<string, unknown> | null;
  if (!native || typeof native !== "object") {
    throw new Error("Unexpected contract response format");
  }

  const chainStatus = CAMPAIGN_STATUS_MAP[Number(native["status"])] ?? String(native["status"]);
  const chainTotalRaised = String(native["total_raised"] ?? "");
  const chainTrancheReleased = String(native["tranche_released"] ?? "");
  const expectedChainStatus = DB_TO_CHAIN_CAMPAIGN[campaign.status] ?? campaign.status;

  if (chainStatus !== expectedChainStatus) {
    findings.push({
      entityType: "campaign",
      entityId: campaignOnChainId,
      contractSet: "production_escrow",
      driftType: "status_mismatch",
      dbValue: { status: campaign.status },
      chainValue: { status: chainStatus },
    });
  }

  if (chainTotalRaised && chainTotalRaised !== campaign.totalRaised) {
    findings.push({
      entityType: "campaign",
      entityId: campaignOnChainId,
      contractSet: "production_escrow",
      driftType: "amount_mismatch",
      dbValue: { totalRaised: campaign.totalRaised },
      chainValue: { totalRaised: chainTotalRaised },
    });
  }

  if (chainTrancheReleased && chainTrancheReleased !== campaign.trancheReleased) {
    findings.push({
      entityType: "campaign",
      entityId: campaignOnChainId,
      contractSet: "production_escrow",
      driftType: "amount_mismatch",
      dbValue: { trancheReleased: campaign.trancheReleased },
      chainValue: { trancheReleased: chainTrancheReleased },
    });
  }

  return findings;
}
