import { rpc, scValToNative } from "@stellar/stellar-sdk";
import logger from "../config/logger.js";
import { config } from "../config/index.js";
import { prisma } from "../config/database.js";
import { NotificationService } from "./notificationService.js";
import { wsManager } from "./wsManager.js";
import type { RawRpcEvent } from "../types/rawRpcEvent.js";
import { BlockchainEventIngestionService } from "./events/blockchainEventIngestionService.js";
import { EscrowEventIngestionService } from "./events/escrowEventIngestionService.js";
import { indexGovernanceEvent } from "./governanceService.js";
import { captureAlert } from "../config/sentry.js";

/**
 * Canonical ingestion pipeline: BlockchainTransaction (transactions table) is
 * the single source of truth. EscrowEvent/EscrowTransaction are derived
 * projections rebuilt from it — not a second parallel ingestion path.
 * This eliminates the Promise.allSettled dual-write duplication and ensures
 * replay idempotency via @@unique([ledger,eventIndex]).
 */

const POLL_INTERVAL_MS = 5_000;
const CHECKPOINT_SERVICE_NAME = "contract-watcher";

/**
 * Extracts the entity, action and decoded data array from a raw RPC event.
 * Topics layout: [entity, action, ...] where entity is e.g. "order"/"split"/"campaign"/"basket"/"governance"
 */
function decodeEvent(event: RawRpcEvent): { entity: string; action: string; data: unknown[] } | null {
  try {
    const topics = (event as any).topic.map((t: unknown) => scValToNative(t as any));
    const entity = String(topics[0] ?? "").toLowerCase();
    const action = String(topics[1] ?? "").toLowerCase();
    const raw = scValToNative((event as any).value as any);
    const data = Array.isArray(raw) ? raw : [raw];
    return { entity, action, data };
  } catch (err) {
    logger.error("Failed to decode contract event", err);
    return null;
  }
}

/**
 * Legacy helper: handleEvent decodes and routes.
 */
function handleEvent(event: RawRpcEvent): void {
  const decoded = decodeEvent(event);
  if (!decoded) return;
  const contractId = (event as any).contractId as string | undefined;
  // Governance contract events are routed to governance indexer but also
  // want broadcasting — handled via dedicated dispatch
  if (contractId && config.governanceContractId && String(contractId) === config.governanceContractId) {
    dispatchGovernanceEvent(decoded.action, decoded.data, event.ledger, decoded.entity, contractId);
    return;
  }
  dispatchEvent(decoded.action, decoded.data, event.ledger, decoded.entity, contractId);
}

// ---------------------------------------------------------------------------
// Dispatchers
// ---------------------------------------------------------------------------

function dispatchGovernanceEvent(
  action: string,
  data: unknown[],
  ledger?: number,
  entity?: string,
  contractId?: string,
): void {
  const fullTopic = `${entity ?? "governance"}.${action}`.toLowerCase();
  // Governance events are already indexed via indexGovernanceEvent in the poll loop,
  // this dispatcher ensures WS push / notifications and indexed-only ack for non-proposal topics.
  switch (fullTopic) {
    // Proposal lifecycle — already indexed, now also broadcast
    case "governance.proposed":
    case "governnc.proposed": {
      const proposalId = String(data[0] ?? "");
      wsManager.broadcastAuthenticated("governance:proposed", { proposalId, ledger, contractId });
      logger.info(`[ContractWatcher] Governance proposed ${proposalId}`);
      break;
    }
    case "governance.voted":
    case "governnc.voted": {
      const proposalId = String(data[0] ?? "");
      wsManager.broadcastAuthenticated("governance:voted", { proposalId, ledger });
      break;
    }
    case "governance.queued":
    case "governnc.queued":
    case "governance.executed":
    case "governnc.executed":
    case "governance.rejected":
    case "governnc.rejected":
    case "governance.cancelled":
    case "governnc.cancelled": {
      const proposalId = String(data[0] ?? "");
      const evt = fullTopic.split(".")[1];
      wsManager.broadcastAuthenticated(`governance:${evt}`, { proposalId, ledger });
      break;
    }
    case "governance.upgraded":
    case "governnc.upgraded":
    case "governance.paused":
    case "governnc.paused":
    case "governance.unpausd":
    case "governnc.unpausd": {
      logger.info(`[ContractWatcher] Governance indexed-only event ${fullTopic} ledger ${ledger}`);
      break;
    }
    default:
      // Also try bare action dispatch (fallback for older topic encoding)
      logger.info(`[ContractWatcher] Governance indexed-only or unhandled ${fullTopic}`);
      // Count as unhandled if truly unknown, but governance namespace is enumerated so this is indexed-only
      break;
  }
}

function dispatchProductionEscrowEvent(
  entity: string,
  action: string,
  data: unknown[],
  ledger?: number,
): boolean {
  const fullTopic = `${entity}.${action}`.toLowerCase();
  switch (fullTopic) {
    case "campaign.created": {
      const campaignId = String(data[0] ?? "");
      const farmer = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("campaign:created", { campaignId, farmer, ledger });
      logger.info(`[ContractWatcher] Campaign created ${campaignId} ledger ${ledger}`);
      // Index-only, no per-user notification for now (campaign notifications are via separate service)
      return true;
    }
    case "campaign.invested": {
      const campaignId = String(data[0] ?? "");
      const investor = String(data[1] ?? "");
      const amount = String(data[2] ?? "");
      wsManager.broadcastAuthenticated("campaign:invested", { campaignId, investor, amount, ledger });
      return true;
    }
    case "campaign.produce":
    case "campaign.harvest":
    case "campaign.milestone":
    case "campaign.tranche":
    case "campaign.settled":
    case "campaign.claimed":
    case "campaign.failed":
    case "campaign.refunded":
    case "campaign.disputed":
    case "campaign.batch_ref": {
      const campaignId = String(data[0] ?? "");
      wsManager.broadcastAuthenticated(`campaign:${action}`, { campaignId, ledger });
      logger.info(`[ContractWatcher] Campaign indexed-only ${fullTopic} ${campaignId}`);
      return true;
    }
    case "campaign.paused":
    case "campaign.unpausd":
    case "campaign.upgraded": {
      logger.info(`[ContractWatcher] Campaign indexed-only ${fullTopic} ledger ${ledger}`);
      return true;
    }
    case "order.created":
    case "order.cancelled":
    case "order.confirmed":
    case "order.splitnew":
    case "order.splitact":
    case "order.splitfnd":
    case "order.splitcnf":
    case "order.splitdsp":
    case "order.splitres":
    case "order.fee_col":
    case "order.fee_ref":
    case "order.batch_ref": {
      // Production escrow order family — reuse escrow handling where applicable
      // For cancelled/confirmed etc delegate to escrow dispatcher with production flag
      return false; // let main dispatcher handle
    }
    default:
      return false;
  }
}

function dispatchBasketEvent(
  entity: string,
  action: string,
  data: unknown[],
  ledger?: number,
): boolean {
  const fullTopic = `${entity}.${action}`.toLowerCase();
  switch (fullTopic) {
    case "basket.created":
    case "basket.fw_close":
    case "basket.deposit":
    case "basket.skipped":
    case "basket.funded":
    case "basket.withdrawn":
    case "basket.claimed": {
      const basketId = String(data[1] ?? data[0] ?? "");
      wsManager.broadcastAuthenticated(`basket:${action}`, { basketId, ledger, data });
      logger.info(`[ContractWatcher] Basket event ${fullTopic} basket ${basketId} ledger ${ledger}`);
      return true;
    }
    case "basket.upgraded":
    case "basket.paused":
    case "basket.unpausd": {
      logger.info(`[ContractWatcher] Basket indexed-only ${fullTopic} ledger ${ledger}`);
      return true;
    }
    default:
      return false;
  }
}

function dispatchRegistryEvent(
  entity: string,
  action: string,
  data: unknown[],
  ledger?: number,
): boolean {
  const fullTopic = `${entity}.${action}`.toLowerCase();
  switch (fullTopic) {
    case "registry.updated":
    case "registry.upgraded":
    case "registry.paused":
    case "registry.unpausd":
    case "farmer.farm_reg":
    case "campaign.camp_reg":
    case "reput.updated":
    case "batch.minted":
    case "batch.linked": {
      logger.info(`[ContractWatcher] Registry indexed-only ${fullTopic} ledger ${ledger}`);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Dispatches a decoded event to the notification service and WebSocket broadcast.
 *
 * Contract event signatures (from escrow/src/lib.rs):
 *   OrderCreated  / FundsLocked  → (order, created)   → data: [order_id, buyer, farmer, amount, token]
 *   DeliveryConfirmed            → (order, confirmed)  → data: [order_id, buyer, farmer]
 *   RefundIssued                 → (order, refunded)   → data: [order_id, buyer]
 *   Cancelled                    → (order, cancelled)  → data: [order_id, buyer]
 *   Disputed/Resolved            → (order, disputed/resolved) → data: [order_id, ...]
 *   Split family                 → (split, created/active/funded/delivrd/complete/confirm/disputed/resolved)
 *   (internal)                   → (order, delivered)  → data: [order_id, farmer, buyer, delivery_ts]
 *
 * Also handles production_escrow, basket, registry, governance via dedicated branches.
 *
 * Metrics: unhandled increments `contract_watcher_unhandled_events_total` and fires a Sentry alert.
 */
export function dispatchEvent(
  action: string,
  data: unknown[],
  ledger?: number,
  entityHint?: string,
  contractIdHint?: string,
): void {
  // Normalize to entity + action
  let entity = (entityHint ?? "").toLowerCase();
  let evtAction = action.toLowerCase();

  // Support legacy callers that pass "order.created" as single action string
  if (!entity && evtAction.includes(".")) {
    const parts = evtAction.split(".");
    entity = parts[0] ?? "";
    evtAction = parts[1] ?? evtAction;
  }
  if (!entity) entity = "order"; // backward compat: escrow order events

  const fullTopic = `${entity}.${evtAction}`;

  // Route production/basket/registry topics to dedicated dispatchers first
  // Governance already handled via handleEvent check, but also handle here if hint present
  if (contractIdHint && config.governanceContractId && String(contractIdHint) === config.governanceContractId) {
    dispatchGovernanceEvent(evtAction, data, ledger, entity, contractIdHint);
    return;
  }

  // Try production escrow
  if (dispatchProductionEscrowEvent(entity, evtAction, data, ledger)) return;
  if (dispatchBasketEvent(entity, evtAction, data, ledger)) return;
  if (dispatchRegistryEvent(entity, evtAction, data, ledger)) return;

  // Governance bare (if entity is governnc/governance but not via contractId route)
  if (entity === "governance" || entity === "governnc") {
    dispatchGovernanceEvent(evtAction, data, ledger, entity, contractIdHint);
    return;
  }

  // Explicit indexed-only for order paused/upgraded/unpausd
  if (fullTopic === "order.paused" || fullTopic === "order.unpausd" || fullTopic === "order.upgraded" || fullTopic === "order.upgrade") {
    logger.info(`[ContractWatcher] Indexed, no notification: ${fullTopic} | order: ${String(data[0] ?? "")} | ledger: ${ledger ?? "?"}`);
    return;
  }

  // Escrow + generic order/split handling
  const orderId = String(data[0] ?? "");

  logger.info(`[ContractWatcher] Event received: ${fullTopic} | order: ${orderId} | ledger: ${ledger ?? "?"}`);

  switch (fullTopic) {
    case "order.created": {
      const buyer = String(data[1] ?? "");
      const farmer = String(data[2] ?? "");
      const amount = String(data[3] ?? "");
      const token = String(data[4] ?? "");

      void NotificationService.notifyFromEscrowEvent({
        action: "created",
        buyerAddress: buyer,
        farmerAddress: farmer,
        orderId,
        amount,
        token,
      });

      wsManager.broadcastAuthenticated("order:created", { orderId, buyer, farmer, amount, token });
      break;
    }

    case "order.delivered": {
      const farmer = String(data[1] ?? "");
      const buyer = String(data[2] ?? "");

      wsManager.broadcastAuthenticated("order:delivered", { orderId, farmer, buyer });
      break;
    }

    case "order.confirmed": {
      const buyer = String(data[1] ?? "");
      const farmer = String(data[2] ?? "");

      void NotificationService.notifyFromEscrowEvent({
        action: "confirmed",
        buyerAddress: buyer,
        farmerAddress: farmer,
        orderId,
      });

      wsManager.broadcastAuthenticated("order:confirmed", { orderId, buyer, farmer });
      break;
    }

    case "order.refunded": {
      const buyer = String(data[1] ?? "");

      void NotificationService.notifyFromEscrowEvent({
        action: "refunded",
        buyerAddress: buyer,
        orderId,
      });

      wsManager.broadcastAuthenticated("order:refunded", { orderId, buyer });
      break;
    }

    case "order.cancelled": {
      const buyer = String(data[1] ?? "");
      // Use REFUNDED notification as closest; template exists, but also emit WS
      void NotificationService.notifyFromEscrowEvent({
        action: "refunded",
        buyerAddress: buyer,
        orderId,
      });
      // Additional explicit cancellation notification if template available
      try {
        void (NotificationService as any).notify?.({
          walletAddress: buyer,
          type: "order_cancelled",
          orderId,
        });
      } catch {}
      wsManager.broadcastAuthenticated("order:cancelled", { orderId, buyer });
      wsManager.broadcastAuthenticated("order:status_changed", { orderId, status: OrderStatus.CANCELLED, buyer });
      break;
    }

    case "order.disputed": {
      // data: [order_id, opened_by, ...]
      const openedBy = String(data[1] ?? "");
      const farmer = String(data[2] ?? "");
      const buyer = openedBy || String(data[0] ?? "");
      // Notify both participants
      if (buyer) void NotificationService.notify({ walletAddress: buyer, type: "order_disputed" as any, orderId }).catch(() => {});
      if (farmer && farmer !== buyer) void NotificationService.notify({ walletAddress: farmer, type: "order_disputed" as any, orderId }).catch(() => {});
      void NotificationService.notifyFromEscrowEvent({ action: "disputed" as any, buyerAddress: buyer, farmerAddress: farmer, orderId }).catch(() => {});
      wsManager.broadcastAuthenticated("order:disputed", { orderId, openedBy, farmer, ledger });
      wsManager.broadcastAuthenticated("order:status_changed", { orderId, status: OrderStatus.DISPUTED, openedBy });
      break;
    }

    case "order.resolved": {
      const resolution = String(data[1] ?? "");
      const buyer = String(data[2] ?? "");
      const farmer = String(data[3] ?? buyer);
      // Notify both
      if (buyer) void NotificationService.notify({ walletAddress: buyer, type: "dispute_resolved" as any, orderId }).catch(() => {});
      if (farmer && farmer !== buyer) void NotificationService.notify({ walletAddress: farmer, type: "dispute_resolved" as any, orderId }).catch(() => {});
      wsManager.broadcastAuthenticated("order:resolved", { orderId, resolution, buyer, farmer, ledger });
      wsManager.broadcastAuthenticated("order:status_changed", { orderId, status: resolution.toUpperCase().includes("REFUND") ? OrderStatus.REFUNDED : OrderStatus.COMPLETED, resolution });
      break;
    }

    // ---- Split order family (escrow) ----
    case "split.created": {
      const farmer = String(data[1] ?? "");
      const token = String(data[2] ?? "");
      const totalAmount = String(data[3] ?? "");
      wsManager.broadcastAuthenticated("split:created", { orderId, farmer, token, totalAmount, ledger });
      if (farmer) void NotificationService.notify({ walletAddress: farmer, type: "split_created" as any, orderId, amount: totalAmount, token }).catch(() => {});
      break;
    }
    case "split.active": {
      const netAmount = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("split:active", { orderId, netAmount, ledger });
      break;
    }
    case "split.funded": {
      const amount = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("split:funded", { orderId, amount, ledger });
      // Also broadcast as order:status for generic listeners
      wsManager.broadcastAuthenticated("order:split_funded", { orderId, amount, ledger });
      break;
    }
    case "split.delivrd":
    case "split.delivered": {
      const farmer = String(data[1] ?? "");
      const buyer = String(data[2] ?? "");
      wsManager.broadcastAuthenticated("split:delivered", { orderId, farmer, buyer, ledger });
      break;
    }
    case "split.complete": {
      wsManager.broadcastAuthenticated("split:complete", { orderId, ledger });
      break;
    }
    case "split.confirm": {
      const confirmer = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("split:confirm", { orderId, confirmer, ledger });
      break;
    }
    case "split.disputed": {
      const caller = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("split:disputed", { orderId, caller, ledger });
      if (caller) void NotificationService.notify({ walletAddress: caller, type: "order_disputed" as any, orderId }).catch(() => {});
      break;
    }
    case "split.resolved": {
      const resolution = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("split:resolved", { orderId, resolution, ledger });
      if (resolution) {
        const buyer = String(data[2] ?? "");
        const farmer = String(data[3] ?? "");
        if (buyer) void NotificationService.notify({ walletAddress: buyer, type: "dispute_resolved" as any, orderId }).catch(() => {});
        if (farmer) void NotificationService.notify({ walletAddress: farmer, type: "dispute_resolved" as any, orderId }).catch(() => {});
      }
      break;
    }

    // ---- Production escrow split variants (order.split*) ----
    case "order.splitnew": {
      const campaignId = String(data[1] ?? "");
      const totalAmount = String(data[2] ?? "");
      wsManager.broadcastAuthenticated("order:splitnew", { orderId, campaignId, totalAmount, ledger });
      wsManager.broadcastAuthenticated("split:created", { orderId, campaignId, totalAmount, ledger });
      break;
    }
    case "order.splitact": {
      wsManager.broadcastAuthenticated("order:splitact", { orderId, ledger });
      wsManager.broadcastAuthenticated("split:active", { orderId, ledger });
      break;
    }
    case "order.splitfnd": {
      wsManager.broadcastAuthenticated("order:splitfnd", { orderId, ledger });
      wsManager.broadcastAuthenticated("split:funded", { orderId, ledger });
      break;
    }
    case "order.splitcnf": {
      const confirmer = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("order:splitcnf", { orderId, confirmer, ledger });
      wsManager.broadcastAuthenticated("split:confirm", { orderId, confirmer, ledger });
      break;
    }
    case "order.splitdsp": {
      const caller = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("order:splitdsp", { orderId, caller, ledger });
      wsManager.broadcastAuthenticated("split:disputed", { orderId, caller, ledger });
      if (caller) void NotificationService.notify({ walletAddress: caller, type: "order_disputed" as any, orderId }).catch(() => {});
      break;
    }
    case "order.splitres": {
      const resolution = String(data[1] ?? "");
      wsManager.broadcastAuthenticated("order:splitres", { orderId, resolution, ledger });
      wsManager.broadcastAuthenticated("split:resolved", { orderId, resolution, ledger });
      break;
    }

    // ---- Group order explicit ack (if any on-chain, treat as indexed+broadcast) ----
    case "group.created":
    case "group.funded":
    case "group.expired":
    case "group.progress": {
      wsManager.broadcastAuthenticated(`group:${evtAction}`, { orderId, ledger, data });
      logger.info(`[ContractWatcher] Group order event ${fullTopic} ledger ${ledger}`);
      break;
    }

    default: {
      // Unknown action — metric + alert, not just warn
      contractWatcherUnhandledTotal.inc({ action: evtAction, entity });
      captureAlert(
        "contract_watcher_unhandled_event",
        `Unhandled contract event ${fullTopic} at ledger ${ledger}`,
        { action: evtAction, entity, fullTopic, ledger, contractId: contractIdHint },
      );
      logger.warn(`[ContractWatcher] Unhandled event action: "${fullTopic}" ledger ${ledger ?? "?"} contract ${contractIdHint ?? "?"}`);
    }
  }
}

export async function loadCheckpoint(): Promise<number | null> {
  try {
    const row = await prisma.contractWatcherCheckpoint.findUnique({
      where: { service: CHECKPOINT_SERVICE_NAME },
    });
    if (row) {
      logger.info(`[ContractWatcher] Loaded checkpoint: ledger ${row.lastLedger}`);
      return row.lastLedger;
    }
    logger.info("[ContractWatcher] No existing checkpoint found");
    return null;
  } catch (err) {
    logger.error("[ContractWatcher] Failed to load checkpoint", err);
    return null;
  }
}

export async function persistCheckpoint(ledger: number): Promise<void> {
  try {
    await prisma.contractWatcherCheckpoint.upsert({
      where: { service: CHECKPOINT_SERVICE_NAME },
      create: { service: CHECKPOINT_SERVICE_NAME, lastLedger: ledger },
      update: { lastLedger: ledger },
    });
    logger.debug(`[ContractWatcher] Persisted checkpoint: ledger ${ledger}`);
  } catch (err) {
    logger.error("[ContractWatcher] Failed to persist checkpoint", err);
  }
}

const RECOVERY_GAP_WARNING_THRESHOLD = 10;

export function detectRecoveryGap(checkpointLedger: number | null, latestLedger: number): void {
  if (checkpointLedger === null) {
    logger.info(`[ContractWatcher] Fresh start — beginning from ledger ${latestLedger}`);
    return;
  }

  const gap = latestLedger - checkpointLedger;
  if (gap <= 0) {
    logger.info(`[ContractWatcher] Checkpoint is ahead of or at latest ledger (checkpoint: ${checkpointLedger}, latest: ${latestLedger})`);
    return;
  }

  if (gap >= RECOVERY_GAP_WARNING_THRESHOLD) {
    logger.warn(
      `[ContractWatcher] Recovery gap detected: ${gap} ledgers behind. Resuming from ledger ${checkpointLedger}. ` +
      `${gap} ledgers of events will be replayed to catch up.`,
    );
  }
}

/**
 * Fetch events with pagination looping on cursor until exhausted for the polled range.
 * Bounded by MAX_LEDGER_SPAN per poll; only advances checkpoint at drained boundary.
 */
export async function fetchEventsPaginated(
  server: rpc.Server,
  startLedger: number,
  endLedger: number,
  contractIds: string[],
): Promise<{ events: RawRpcEvent[]; pages: number; drained: boolean }> {
  const allEvents: RawRpcEvent[] = [];
  let cursor: string | undefined = undefined;
  let pages = 0;
  let drained = true;

  while (true) {
    const response: any = await (server as any).getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds }],
      cursor,
      limit: 100,
    });
    pages++;
    const events: RawRpcEvent[] = response.events ?? [];
    // No events case — check cursor to decide drained
    if (events.length === 0) {
      if (!response.cursor) {
        drained = true;
        break;
      }
      // Has cursor but no events — continue paging (edge of pagination)
      cursor = response.cursor;
      if (pages >= MAX_PAGES_PER_POLL) {
        drained = false;
        logger.warn("[ContractWatcher] Pagination hit max pages with empty events, marking not drained");
        break;
      }
      continue;
    }

    // Partition by span to enforce bounded ledger window
    const inSpan: RawRpcEvent[] = events.filter((e: any) => (e.ledger as number) <= endLedger);
    const beyondSpan: RawRpcEvent[] = events.filter((e: any) => (e.ledger as number) > endLedger);
    allEvents.push(...inSpan);

    // If we encountered events beyond the bounded span, we have fully covered the span
    // (all later pages will be beyond). Stop pagination for this poll; drained=true.
    if (beyondSpan.length > 0) {
      drained = true;
      break;
    }

    // If server indicates more pages via cursor, continue
    if (response.cursor) {
      cursor = response.cursor;
      if (pages >= MAX_PAGES_PER_POLL) {
        drained = false;
        logger.warn("[ContractWatcher] Pagination hit max pages limit, marking not drained", { pages, startLedger, endLedger });
        break;
      }
      // Continue to next page
      continue;
    }

    // No cursor => fully drained
    drained = true;
    break;
  }

  return { events: allEvents, pages, drained };
}

export async function startContractWatcher(): Promise<void> {
  const { contractId, governanceContractId, rpcUrl } = config;

  if (!contractId && !governanceContractId) {
    logger.warn("[ContractWatcher] No contract IDs set — skipping event listener.");
    return;
  }

  const server = new rpc.Server(rpcUrl);
  const checkpointLedger = await loadCheckpoint();

  let lastLedger: number;
  if (checkpointLedger !== null) {
    lastLedger = checkpointLedger;
  } else {
    lastLedger = (await server.getLatestLedger()).sequence;
  }

  const latestLedger = (await server.getLatestLedger()).sequence;
  detectRecoveryGap(checkpointLedger, latestLedger);

  const contractIds = [contractId, governanceContractId].filter(Boolean) as string[];
  logger.info(`[ContractWatcher] Listening for events on contracts ${contractIds.join(", ")} from ledger ${lastLedger} (max span ${MAX_LEDGER_SPAN}, max pages ${MAX_PAGES_PER_POLL})`);

  let running = false;

  async function poll() {
    if (running) {
      logger.debug("[ContractWatcher] Previous poll still running, skipping this tick");
      scheduleNext();
      return;
    }
    running = true;
    try {
      const latestSeq = (await server.getLatestLedger()).sequence;
      const endLedger = Math.min(lastLedger + MAX_LEDGER_SPAN, latestSeq);

      // Fetch with pagination — fully drain range before advancing checkpoint
      const { events, pages, drained } = await fetchEventsPaginated(server as any, lastLedger, endLedger, contractIds);

      // Metrics per poll
      contractWatcherPagesPerPoll.observe(pages);
      contractWatcherEventsPerPoll.observe(events.length);

      logger.debug(`[ContractWatcher] Poll fetched ${events.length} events across ${pages} page(s) drained=${drained} range [${lastLedger}, ${endLedger}]`);

      if (!drained) {
        logger.warn(`[ContractWatcher] Pagination not drained for range [${lastLedger}, ${endLedger}] pages=${pages} — will retry without advancing checkpoint`);
        captureAlert("contract_watcher_pagination_not_drained", `Contract watcher pagination not drained for range [${lastLedger}, ${endLedger}]`, {
          startLedger: lastLedger,
          endLedger,
          pages,
        });
        return;
      }

      if (events.length === 0) {
        // No events in this bounded window — advance checkpoint to end of window to make progress
        if (endLedger >= lastLedger) {
          const newCheckpoint = endLedger + 1;
          // Only advance if we actually moved forward and are at tip or drained
          if (newCheckpoint > lastLedger) {
            lastLedger = newCheckpoint;
            await persistCheckpoint(lastLedger);
            logger.debug(`[ContractWatcher] No events in span, advanced checkpoint to ${lastLedger}`);
          }
        }
        return;
      }

      let maxProcessedLedger = lastLedger;
      let processedCount = 0;

      for (const event of events) {
        if ((event as any).ledger < lastLedger) {
          logger.debug(`[ContractWatcher] Skipping duplicate event at ledger ${(event as any).ledger} (already processed)`);
          continue;
        }

        const isGovernanceEvent =
          Boolean(governanceContractId) && String(event.contractId) === governanceContractId;

        if (isGovernanceEvent && decodeEvent(event)) {
          const decoded = decodeEvent(event)!;
          try {
            await indexGovernanceEvent(
              decoded.action,
              decoded.data,
              event.ledger,
              event.transactionIndex,
            );
          } catch (err) {
            logger.error("[ContractWatcher] Governance ingestion failed", {
              error: err instanceof Error ? err.message : String(err),
              ledger: event.ledger,
            });
            captureAlert(
              "contract_watcher_ingestion_failure",
              `Governance ingestion failed at ledger ${event.ledger}, checkpoint advance halted`,
              { ledger: event.ledger },
            );
            return;
          }
          if (event.ledger >= maxProcessedLedger) maxProcessedLedger = event.ledger + 1;
          continue;
        }

        // Canonical pipeline: single ingestion, idempotent via BlockchainTransaction @@unique
        // Dead-lettered (validation) events are swallowed inside persist() and still advance checkpoint
        try {
          await BlockchainEventIngestionService.ingestEvent(event);
        } catch (err) {
          // Transient failures (DB, RPC) — halt checkpoint and retry next poll
          // Validation/dead-letter failures are already handled inside persist() and would not throw
          logger.error("[ContractWatcher] Ingestion failed for event", {
            error: err instanceof Error ? err.message : String(err),
            ledger: event.ledger,
          });
          logger.error(
            `[ContractWatcher] Halting checkpoint advance at ledger ${(event as any).ledger} due to ingestion failure. Will retry on next poll.`,
          );
          captureAlert(
            "contract_watcher_ingestion_failure",
            `Contract watcher ingestion failed at ledger ${event.ledger}, checkpoint advance halted`,
            { ledger: event.ledger },
          );
          return;
        }

        // Best-effort derived projection (does not block checkpoint). Failures are logged only.
        // EscrowEvent/EscrowTransaction are rebuildable from canonical BlockchainTransaction.
        void EscrowEventIngestionService.ingestEvent(event).catch((err) => {
          logger.warn("[ContractWatcher] Derived Escrow projection failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
            ledger: event.ledger,
          });
        });

        if (!isGovernanceEvent) handleEvent(event);

        processedCount++;
        if ((event as any).ledger >= maxProcessedLedger) {
          maxProcessedLedger = (event as any).ledger + 1;
        }
      }

      // Only persist checkpoint at fully-drained boundary, after all events in pages are persisted
      // Advance to max of endLedger+1 and maxProcessedLedger to ensure bounded progress even if events sparse
      const newCheckpoint = Math.max(maxProcessedLedger, endLedger + 1);
      if (newCheckpoint > lastLedger) {
        lastLedger = newCheckpoint;
        await persistCheckpoint(lastLedger);
        logger.info(`[ContractWatcher] Advanced checkpoint to ${lastLedger} after processing ${processedCount} events in ${pages} page(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("startLedger must be within the retention window")) {
        logger.warn(`[ContractWatcher] Retention window exceeded — resetting checkpoint to latest ledger`);
        try {
          const latest = (await server.getLatestLedger()).sequence;
          lastLedger = latest;
          await persistCheckpoint(lastLedger);
          captureAlert(
            "contract_watcher_retention_window_reset",
            `Contract watcher checkpoint reset to ledger ${lastLedger} after retention window error`,
            { checkpoint: lastLedger },
          );
        } catch (resetErr) {
          logger.error("[ContractWatcher] Failed to reset checkpoint after retention error", resetErr);
        }
        return;
      }
      logger.error("[ContractWatcher] Poll error", err);
      // Sentry groups identical errors into one issue, so a sustained RPC
      // outage polling every 5s doesn't need its own cooldown logic here —
      // configure the alert rule to notify on new/regressed issues, not
      // every event (see docs/OBSERVABILITY.md).
      captureAlert("contract_watcher_poll_error", "Contract watcher poll iteration failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
      scheduleNext();
    }
  }

  function scheduleNext() {
    setTimeout(poll, POLL_INTERVAL_MS);
  }

  scheduleNext();
}
