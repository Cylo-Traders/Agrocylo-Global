import { rpc } from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import logger from "../config/logger.js";
import { prisma } from "../db/client.js";
import { ProductionEventParser } from "./parser.js";
import { EventPersister } from "./persister.js";
import { recordPersistError } from "./metrics.js";
import type { RawSorobanEvent } from "./types.js";

const POLL_INTERVAL_MS = 5_000;
const MAX_LEDGER_GAP = 1_000;
// base64 encoding of event topic symbols
const CAMPAIGN_TOPIC = "AAAADwAAAAhjYW1wYWlnbg==";
const ORDER_TOPIC = "AAAADwAAAAVvcmRlcg==";
const DISPUTE_TOPIC = "AAAADwAAAAdkaXNwdXRl";

/**
 * Loads the last persisted ledger checkpoint from the database.
 * Falls back to the current on-chain tip when no checkpoint exists.
 */
async function loadCheckpoint(server: rpc.Server): Promise<number> {
  const lastTx = await prisma.transaction.findFirst({ orderBy: { ledger: "desc" } });
  if (lastTx) {
    logger.info("Production watcher: resuming from persisted checkpoint", {
      ledger: lastTx.ledger,
    });
    return lastTx.ledger;
  }
  const latest = await server.getLatestLedger();
  logger.info("Production watcher: no checkpoint found, starting from current ledger", {
    ledger: latest.sequence,
  });
  return latest.sequence;
}

/**
 * Detects gaps between the local checkpoint and the current on-chain tip and
 * fast-forwards the checkpoint when the gap exceeds MAX_LEDGER_GAP to prevent
 * unbounded re-processing on long outages.
 */
async function reconcileGap(server: rpc.Server, lastLedger: number): Promise<number> {
  try {
    const latest = await server.getLatestLedger();
    const gap = latest.sequence - lastLedger;
    if (gap > MAX_LEDGER_GAP) {
      logger.warn("Production watcher: large ledger gap detected, fast-forwarding checkpoint", {
        lastLedger,
        currentLedger: latest.sequence,
        gap,
        maxGap: MAX_LEDGER_GAP,
      });
      return latest.sequence - MAX_LEDGER_GAP;
    }
  } catch (err) {
    logger.warn("Production watcher: could not fetch latest ledger for gap check", { error: err });
  }
  return lastLedger;
}

/**
 * Consolidated Soroban event ingestion pipeline.
 * Watches all configured contract IDs and ingests events from configured topics.
 * This is the canonical ingestion path replacing the deprecated sorobanEventListener.
 *
 * Handles:
 * - Escrow contract order events
 * - Production contract campaign, order, and dispute events
 * - Checkpoint persistence to resume from last known state
 * - Gap reconciliation for long outages
 */
export async function startProductionWatcher(): Promise<ReturnType<typeof setInterval> | null> {
  const server = new rpc.Server(config.rpcUrl);

  const contracts = buildContractFilters();
  if (contracts.length === 0) {
    logger.warn(
      "No contract IDs configured. Soroban event watcher will not start. " +
      "Set PRODUCTION_CONTRACT_ID and/or ESCROW_CONTRACT_ID / PRODUCTION_ESCROW_CONTRACT_ID.",
    );
    return null;
  }

  logger.info("Soroban event watcher started", {
    contractCount: contracts.length,
    contracts: contracts.map((c) => c.contractId),
  });

  let lastLedger = await loadCheckpoint(server);
  lastLedger = await reconcileGap(server, lastLedger);

  const interval = setInterval(async () => {
    try {
      const response = await server.getEvents({
        startLedger: lastLedger,
        filters: contracts,
      });

      let highWaterMark = lastLedger;
      let eventCount = 0;

      for (const rawEvent of response.events) {
        const event = ProductionEventParser.tryParse(rawEvent as unknown as RawSorobanEvent);
        if (event) {
          await EventPersister.persist(event).catch((err) => {
            recordPersistError();
            logger.error("EventPersister error", { error: err, ledger: rawEvent.ledger });
          });
          eventCount++;
        }
        if (rawEvent.ledger > highWaterMark) {
          highWaterMark = rawEvent.ledger;
        }
      }

      if (highWaterMark > lastLedger) {
        lastLedger = highWaterMark + 1;
        logger.debug("Soroban watcher: checkpoint advanced", {
          ledger: lastLedger,
          eventsProcessed: eventCount,
        });
      }
    } catch (err) {
      logger.error("Soroban watcher poll error", { error: err });
    }
  }, POLL_INTERVAL_MS);

  return interval;
}

function buildContractFilters() {
  const filters: any[] = [];

  if (config.escrowContractId) {
    filters.push(
      {
        type: "contract" as const,
        contractIds: [config.escrowContractId],
        topics: [[ORDER_TOPIC, "*"]],
      }
    );
  }

  if (config.productionEscrowContractId) {
    filters.push(
      {
        type: "contract" as const,
        contractIds: [config.productionEscrowContractId],
        topics: [[CAMPAIGN_TOPIC, "*"]],
      },
      {
        type: "contract" as const,
        contractIds: [config.productionEscrowContractId],
        topics: [[ORDER_TOPIC, "*"]],
      },
      {
        type: "contract" as const,
        contractIds: [config.productionEscrowContractId],
        topics: [[DISPUTE_TOPIC, "*"]],
      }
    );
  }

  if (config.contractId && config.contractId !== "C...") {
    filters.push(
      {
        type: "contract" as const,
        contractIds: [config.contractId],
        topics: [[CAMPAIGN_TOPIC, "*"]],
      },
      {
        type: "contract" as const,
        contractIds: [config.contractId],
        topics: [[ORDER_TOPIC, "*"]],
      }
    );
  }

  return filters;
}
