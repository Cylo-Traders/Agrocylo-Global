import { rpc } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import logger from "../config/logger.js";
import { prisma } from "../db/client.js";
import { ProductionEventParser } from "./parser.js";
import { EventPersister } from "./persister.js";
import type { RawSorobanEvent } from "./types.js";

const POLL_INTERVAL_MS = 5_000;
// base64 encoding of "campaign" and "order" short symbols
const CAMPAIGN_TOPIC = "AAAADwAAAAhjYW1wYWlnbg==";
const ORDER_TOPIC = "AAAADwAAAAVvcmRlcg==";

export async function startProductionWatcher(): Promise<void> {
  const server = new rpc.Server(config.rpcUrl);
  logger.info("Production contract watcher started", { contractId: config.contractId });

  // Resume from the last persisted ledger to avoid re-processing on restart.
  const lastTx = await prisma.transaction.findFirst({ orderBy: { ledger: "desc" } });
  let lastLedger = lastTx?.ledger ?? (await server.getLatestLedger()).sequence;

  setInterval(async () => {
    try {
      const response = await server.getEvents({
        startLedger: lastLedger,
        filters: [
          {
            type: "contract",
            contractIds: [config.contractId],
            topics: [[CAMPAIGN_TOPIC, "*"]],
          },
          {
            type: "contract",
            contractIds: [config.contractId],
            topics: [[ORDER_TOPIC, "*"]],
          },
        ],
      });

      for (const rawEvent of response.events) {
        const event = ProductionEventParser.tryParse(rawEvent as unknown as RawSorobanEvent);
        if (event) {
          await EventPersister.persist(event).catch((err) =>
            logger.error("EventPersister error", { error: err }),
          );
        }
        if (rawEvent.ledger > lastLedger) {
          lastLedger = rawEvent.ledger + 1;
        }
      }
    } catch (err) {
      logger.error("Production watcher poll error", { error: err });
    }
  }, POLL_INTERVAL_MS);
}
