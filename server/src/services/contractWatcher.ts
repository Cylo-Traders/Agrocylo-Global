import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import logger from "../config/logger.js";
import prisma from "../config/database.js";

const CONTRACT_ID = process.env.CONTRACT_ID || "C...";
const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";

const server = new rpc.Server(RPC_URL);

// This service "watches" the blockchain for our Escrow events
export async function startContractWatcher() {
  logger.info("Contract Watcher Service started...");

  // In a real app, you'd save the lastLedger in the DB so you don't skip events if the server restarts
  let lastKnownLedger = (await server.getLatestLedger()).sequence;

  setInterval(async () => {
    try {
      const response = await server.getEvents({
        startLedger: lastKnownLedger,
        filters: [
          {
            type: "contract",
            contractIds: [CONTRACT_ID],

            topics: [["AAAADwAAAAVvcmRlcg==", "*"]],
          },
        ],
      });

      for (const event of response.events) {
        handleContractEvent(event);
        // Update ledger tracker to avoid processing the same event twice
        if (event.ledger > lastKnownLedger) {
          lastKnownLedger = event.ledger + 1;
        }
      }
    } catch (error) {
      logger.error("Watcher Error:", error);
    }
  }, 5000);
}

//Logic to process the raw blockchain data into readable notifications
function handleContractEvent(event: any) {
  const topics = event.topic.map((t: string) =>
    scValToNative(xdr.ScVal.fromXDR(t, "base64")),
  );

  const action = topics[1];

  // The value of the event
  const data = scValToNative(xdr.ScVal.fromXDR(event.value, "base64"));

  logger.info(`New Event Detected: ${action}`);

  const orderId = data[0].toString();

  switch (action) {
    case "created":
      notifyUser(
        data[2],
        `New Order Alert! You have a new order #${orderId} for ${data[3]} tokens.`,
        orderId,
        action,
      );
      break;
    case "confirmed":
      notifyUser(
        data[2],
        `Payment Released! Buyer confirmed receipt for order #${orderId}.`,
        orderId,
        action,
      );
      break;
    case "refunded":
      notifyUser(
        data[1],
        `Refund Issued. Order #${orderId} was expired and funds returned.`,
        orderId,
        action,
      );
      break;
  }
}

async function notifyUser(
  address: string,
  message: string,
  orderId: string,
  type: string,
) {
  try {
    // Save to Database
    const notification = await prisma.notification.create({
      data: {
        walletAddress: address,
        message: message,
        orderId: orderId.toString(),
        type: type,
        isRead: false,
      },
    });

    logger.info(
      `Notification saved to DB for ${address}: ID ${notification.id}`,
    );
  } catch (error) {
    logger.error("Failed to save notification to DB:", error);
  }
}
