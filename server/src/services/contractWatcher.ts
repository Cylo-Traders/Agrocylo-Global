import { rpc, scValToNative } from "@stellar/stellar-sdk";
import logger from "../config/logger.js";
import { config } from "../config/index.js";
import { prisma } from "../config/database.js";
import { NotificationService } from "./notificationService.js";
import { wsManager } from "./wsManager.js";
import type { RawRpcEvent } from "../types/rawRpcEvent.js";

const POLL_INTERVAL_MS = 5_000;
const CHECKPOINT_SERVICE_NAME = "contract-watcher";

/**
 * Extracts the action string and decoded data array from a raw RPC event.
 * Topics layout: [entity, action, ...]
 */
function decodeEvent(event: RawRpcEvent): { action: string; data: unknown[] } | null {
  try {
    const topics = event.topic.map((t) => scValToNative(t));
    const action = String(topics[1] ?? "").toLowerCase();
    const raw = scValToNative(event.value);
    const data = Array.isArray(raw) ? raw : [raw];
    return { action, data };
  } catch (err) {
    logger.error("Failed to decode contract event", err);
    return null;
  }
}

/**
 * Dispatches a decoded event to the notification service and WebSocket broadcast.
 *
 * Contract event signatures (from escrow/src/lib.rs):
 *   OrderCreated  / FundsLocked  → (order, created)   → data: [order_id, buyer, farmer, amount, token]
 *   DeliveryConfirmed            → (order, confirmed)  → data: [order_id, buyer, farmer]
 *   RefundIssued                 → (order, refunded)   → data: [order_id, buyer]
 *   (internal)                   → (order, delivered)  → data: [order_id, farmer, buyer, delivery_ts]
 */
function handleEvent(event: RawRpcEvent): void {
  const decoded = decodeEvent(event);
  if (!decoded) return;
  dispatchEvent(decoded.action, decoded.data, event.ledger);
}

/**
 * Dispatches a decoded escrow event to the notification service and WebSocket
 * broadcast. Split out from {@link handleEvent} so the routing logic can be
 * unit-tested with plain decoded data.
 */
export function dispatchEvent(
  action: string,
  data: unknown[],
  ledger?: number,
): void {
  const orderId = String(data[0] ?? "");

  logger.info(`[ContractWatcher] Event received: ${action} | order: ${orderId} | ledger: ${ledger ?? "?"}`);

  switch (action) {
    case "created": {
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

      wsManager.broadcast("order:created", { orderId, buyer, farmer, amount, token });
      break;
    }

    case "delivered": {
      const farmer = String(data[1] ?? "");
      const buyer = String(data[2] ?? "");

      wsManager.broadcast("order:delivered", { orderId, farmer, buyer });
      break;
    }

    case "confirmed": {
      const buyer = String(data[1] ?? "");
      const farmer = String(data[2] ?? "");

      void NotificationService.notifyFromEscrowEvent({
        action: "confirmed",
        buyerAddress: buyer,
        farmerAddress: farmer,
        orderId,
      });

      wsManager.broadcast("order:confirmed", { orderId, buyer, farmer });
      break;
    }

    case "refunded": {
      const buyer = String(data[1] ?? "");

      void NotificationService.notifyFromEscrowEvent({
        action: "refunded",
        buyerAddress: buyer,
        orderId,
      });

      wsManager.broadcast("order:refunded", { orderId, buyer });
      break;
    }

    default:
      logger.warn(`[ContractWatcher] Unhandled event action: "${action}"`);
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

export async function startContractWatcher(): Promise<void> {
  const { contractId, rpcUrl } = config;

  if (!contractId) {
    logger.warn("[ContractWatcher] CONTRACT_ID not set — skipping event listener.");
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

  logger.info(`[ContractWatcher] Listening for events on contract ${contractId} from ledger ${lastLedger}`);

  setInterval(async () => {
    try {
      const response = await server.getEvents({
        startLedger: lastLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
      });

      const events = response.events;
      if (events.length === 0) return;

      let maxProcessedLedger = lastLedger;

      for (const event of events) {
        if (event.ledger < lastLedger) {
          logger.debug(`[ContractWatcher] Skipping duplicate event at ledger ${event.ledger} (already processed)`);
          continue;
        }

        void import("./events/blockchainEventIngestionService.js")
          .then(({ BlockchainEventIngestionService }) => BlockchainEventIngestionService.ingestEvent(event))
          .catch((err) => logger.error("[ContractWatcher] BlockchainEventIngestionService import failed", err));

        void import("./events/escrowEventIngestionService.js")
          .then(({ EscrowEventIngestionService }) => EscrowEventIngestionService.ingestEvent(event))
          .catch((err) => logger.error("[ContractWatcher] EscrowEventIngestionService import failed", err));

        handleEvent(event);

        if (event.ledger >= maxProcessedLedger) {
          maxProcessedLedger = event.ledger + 1;
        }
      }

      if (maxProcessedLedger > lastLedger) {
        lastLedger = maxProcessedLedger;
        await persistCheckpoint(lastLedger);
      }
    } catch (err) {
      logger.error("[ContractWatcher] Poll error", err);
    }
  }, POLL_INTERVAL_MS);
}
