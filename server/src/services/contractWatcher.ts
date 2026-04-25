import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import logger from "../config/logger.js";
import { prisma } from "../config/database.js";
import { wsManager } from "./wsManager.js";
import { NotificationService } from "./notificationService.js";

const CONTRACT_ID = process.env.CONTRACT_ID;
const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";

export async function startContractWatcher() {
  if (!CONTRACT_ID) {
    logger.warn("CONTRACT_ID not set, skipping contract watcher.");
    return;
  }

  const server = new rpc.Server(RPC_URL);
  logger.info("Contract Watcher Service started...");
  let lastKnownLedger = (await server.getLatestLedger()).sequence;

  setInterval(async () => {
    try {
      const response = await server.getEvents({
        startLedger: lastKnownLedger,
        filters: [
          {
            type: "contract",
            contractIds: [CONTRACT_ID],
          },
        ],
      });
      for (const event of response.events) {
        import("./events/blockchainEventIngestionService.js")
          .then(({ BlockchainEventIngestionService }) => {
            BlockchainEventIngestionService.ingestEvent(event);
          })
          .catch((err) =>
            logger.error("Dynamic Import Fail (BlockchainEventIngestionService):", err),
          );
        // --- NEW: Structured Ingestion for the Indexer ---
        import("./events/escrowEventIngestionService.js")
          .then(({ EscrowEventIngestionService }) => {
            EscrowEventIngestionService.ingestEvent(event);
          })
          .catch((err) => logger.error("Dynamic Import Fail (IngestionService):", err));
        handleContractEvent(event);
        if (event.ledger > lastKnownLedger) {
          lastKnownLedger = event.ledger + 1;
        }
      }
    } catch (error) {
      logger.error("Watcher Error:", error);
    }
  }, 5000);
}

function handleContractEvent(event: any) {
  const topics = event.topic.map((t: string) =>
    scValToNative(xdr.ScVal.fromXDR(t, "base64")),
  );
  const action = topics[1];
  const data = scValToNative(xdr.ScVal.fromXDR(event.value, "base64"));
  logger.info(`New Event Detected: ${action}`);
  const orderId = data[0].toString();
  switch (action) {
    case "created":
      notifyUser(data[2], `New Order Alert! You have a new order #${orderId} for ${data[3]} tokens.`, orderId, action);
      break;
    case "confirmed":
      notifyUser(data[2], `Payment Released! Buyer confirmed receipt for order #${orderId}.`, orderId, action);
      break;
    case "refunded":
      notifyUser(data[1], `Refund Issued. Order #${orderId} was expired and funds returned.`, orderId, action);
      notifyUser(
        data[2],
        `New Order Alert! You have a new order #${orderId} for ${data[3]} tokens.`,
        orderId,
        action,
      );
      wsManager.broadcast("order:created", {
        orderId: orderId.toString(),
        buyer: data[2],
        seller: data[1],
        amount: data[3],
      });
      break;
    case "confirmed":
      notifyUser(
        data[2],
        `Payment Released! Buyer confirmed receipt for order #${orderId}.`,
        orderId,
        action,
      );
      wsManager.broadcast("order:confirmed", {
        orderId: orderId.toString(),
        buyer: data[2],
      });
      break;
    case "refunded":
      notifyUser(
        data[1],
        `Refund Issued. Order #${orderId} was expired and funds returned.`,
        orderId,
        action,
      );
      wsManager.broadcast("order:refunded", {
        orderId: orderId.toString(),
        seller: data[1],
      });
      break;
  }
}

async function notifyUser(address: string, message: string, orderId: string, type: string) {
  try {
    const notification = await prisma.notification.create({
      data: { walletAddress: address, message, orderId: orderId.toString(), type, isRead: false },
    });
    logger.info(`Notification saved to DB for ${address}: ID ${notification.id}`);
  } catch (error) {
    logger.error("Failed to save notification to DB:", error);
  }
}
  NotificationService.notifyFromEscrowEvent({
    action,
    orderId,
    buyerAddress: data[1],
    farmerAddress: data[2],
    amount: data[3]?.toString?.(),
    token: data[4],
  });
}
