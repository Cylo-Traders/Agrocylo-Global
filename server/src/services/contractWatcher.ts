import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import logger from "../config/logger.js";
import { config } from "../config/index.js";
import { NotificationService } from "./notificationService.js";
import { wsManager } from "./wsManager.js";

const POLL_INTERVAL_MS = 5_000;

/**
 * Decodes a raw Soroban event topic/value from base64 XDR.
 */
function decodeScVal(base64: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(base64, "base64"));
}

/**
 * Extracts the action string and decoded data array from a raw RPC event.
 * Topics layout: [entity, action, ...]
 */
function decodeEvent(event: any): { action: string; data: unknown[] } | null {
  try {
    const topics = (event.topic as string[]).map(decodeScVal);
    const action = String(topics[1] ?? "").toLowerCase();
    const raw = decodeScVal(event.value as string);
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
function handleEvent(event: any): void {
  const decoded = decodeEvent(event);
  if (!decoded) return;

  const { action, data } = decoded;
  const orderId = String(data[0] ?? "");

  logger.info(`[ContractWatcher] Event received: ${action} | order: ${orderId} | ledger: ${event.ledger}`);

  switch (action) {
    case "created": {
      // data: [order_id, buyer, farmer, amount, token]
      const buyer = String(data[1] ?? "");
      const farmer = String(data[2] ?? "");
      const amount = String(data[3] ?? "");
      const token = String(data[4] ?? "");

      // OrderCreated → notify buyer
      // FundsLocked  → notify farmer (funds locked in escrow on their behalf)
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
      // data: [order_id, farmer, buyer, delivery_timestamp]
      // Internal state change — no payment movement; broadcast status update only.
      const farmer = String(data[1] ?? "");
      const buyer = String(data[2] ?? "");

      wsManager.broadcast("order:delivered", { orderId, farmer, buyer });
      break;
    }

    case "confirmed": {
      // data: [order_id, buyer, farmer]
      // DeliveryConfirmed → payment released to farmer.
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
      // data: [order_id, buyer]
      // RefundIssued → funds returned to buyer.
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

/**
 * Starts the Soroban event listener.
 *
 * Connects to the Stellar RPC, subscribes to all contract events for the
 * configured escrow contract, decodes them, and dispatches notifications
 * and WebSocket broadcasts in real time.
 *
 * Tracked events:
 *   - OrderCreated  (order.created)
 *   - FundsLocked   (order.created — funds locked at order creation)
 *   - DeliveryConfirmed (order.confirmed)
 *   - RefundIssued  (order.refunded)
 */
export async function startContractWatcher(): Promise<void> {
  const { contractId, rpcUrl } = config;

  if (!contractId) {
    logger.warn("[ContractWatcher] CONTRACT_ID not set — skipping event listener.");
    return;
  }

  const server = new rpc.Server(rpcUrl);
  let lastLedger = (await server.getLatestLedger()).sequence;

  logger.info(`[ContractWatcher] Listening for events on contract ${contractId} from ledger ${lastLedger}`);

  setInterval(async () => {
    try {
      const response = await server.getEvents({
        startLedger: lastLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
      });

      for (const event of response.events) {
        // Route through the structured ingestion pipeline (persistence + projection)
        void import("./events/blockchainEventIngestionService.js")
          .then(({ BlockchainEventIngestionService }) => BlockchainEventIngestionService.ingestEvent(event))
          .catch((err) => logger.error("[ContractWatcher] BlockchainEventIngestionService import failed", err));

        void import("./events/escrowEventIngestionService.js")
          .then(({ EscrowEventIngestionService }) => EscrowEventIngestionService.ingestEvent(event))
          .catch((err) => logger.error("[ContractWatcher] EscrowEventIngestionService import failed", err));

        // Dispatch notifications and real-time WebSocket events
        handleEvent(event);

        if (event.ledger >= lastLedger) {
          lastLedger = event.ledger + 1;
        }
      }
    } catch (err) {
      logger.error("[ContractWatcher] Poll error", err);
    }
  }, POLL_INTERVAL_MS);
}
