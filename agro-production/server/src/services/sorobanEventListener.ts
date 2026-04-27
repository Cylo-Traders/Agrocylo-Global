import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import logger from '../config/logger.js';
import { query } from '../config/database.js';
import { config } from '../config/index.js';

interface ContractConfig {
  id: string;
  label: string;
  topicFilters: string[][];
}

interface ParsedEvent {
  contractId: string;
  contractLabel: string;
  action: string;
  data: unknown;
  ledger: number;
  txHash: string;
}

const server = new rpc.Server(config.rpcUrl);

// Topic base64 encoding for "order" and "campaign" symbols.
// These match the symbol_short! values emitted by the Soroban contracts.
const ORDER_TOPIC = 'AAAADwAAAAVvcmRlcg==';   // symbol_short!("order")
const CAMPAIGN_TOPIC = 'AAAADwAAAAhjYW1wYWlnbg=='; // symbol_short!("campaign")
const DISPUTE_TOPIC = 'AAAADwAAAAdkaXNwdXRl';  // symbol_short!("dispute")

function buildContracts(): ContractConfig[] {
  const contracts: ContractConfig[] = [];

  if (config.escrowContractId) {
    contracts.push({
      id: config.escrowContractId,
      label: 'EscrowContract',
      topicFilters: [
        [ORDER_TOPIC, '*'],
      ],
    });
  }

  if (config.productionEscrowContractId) {
    contracts.push({
      id: config.productionEscrowContractId,
      label: 'ProductionEscrowContract',
      topicFilters: [
        [ORDER_TOPIC, '*'],
        [CAMPAIGN_TOPIC, '*'],
        [DISPUTE_TOPIC, '*'],
      ],
    });
  }

  return contracts;
}

function parseEvent(event: rpc.Api.EventResponse, label: string): ParsedEvent | null {
  try {
    const topics = event.topic.map((t: string) =>
      scValToNative(xdr.ScVal.fromXDR(t, 'base64')),
    );
    const action = String(topics[1]);
    const data = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));
    return {
      contractId: event.contractId,
      contractLabel: label,
      action,
      data,
      ledger: event.ledger,
      txHash: event.txHash,
    };
  } catch (err) {
    logger.error(`Failed to parse event from ${label}:`, err);
    return null;
  }
}

async function persistEvent(parsed: ParsedEvent): Promise<void> {
  try {
    await query(
      `insert into production_events
         (contract_id, contract_label, action, data, ledger, tx_hash, created_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (tx_hash, action) do nothing`,
      [
        parsed.contractId,
        parsed.contractLabel,
        parsed.action,
        JSON.stringify(parsed.data),
        parsed.ledger,
        parsed.txHash,
      ],
    );
  } catch (err) {
    // Non-fatal: log and continue — events must never crash the listener.
    logger.warn(`Could not persist event (tx: ${parsed.txHash}):`, err);
  }
}

async function handleEvent(parsed: ParsedEvent): Promise<void> {
  logger.info(
    `[${parsed.contractLabel}] ${parsed.action} @ ledger ${parsed.ledger} (tx: ${parsed.txHash})`,
  );
  logger.debug(`Event data: ${JSON.stringify(parsed.data)}`);
  await persistEvent(parsed);
}

async function pollContract(
  contract: ContractConfig,
  lastLedger: number,
): Promise<number> {
  let highWatermark = lastLedger;

  for (const topicFilter of contract.topicFilters) {
    try {
      const response = await server.getEvents({
        startLedger: lastLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [contract.id],
            topics: [topicFilter],
          },
        ],
      });

      for (const event of response.events) {
        const parsed = parseEvent(event, contract.label);
        if (parsed) {
          await handleEvent(parsed);
        }
        if (event.ledger > highWatermark) {
          highWatermark = event.ledger + 1;
        }
      }
    } catch (err) {
      logger.error(`Poll error for ${contract.label} (filter: ${topicFilter}):`, err);
    }
  }

  return highWatermark;
}

/**
 * Start the Soroban event listener.
 *
 * Connects to the Soroban RPC and polls all configured contract IDs every
 * 5 seconds. The high-watermark ledger is tracked in memory so no events are
 * missed during runtime. A production deployment should persist it to the DB
 * so the listener can resume after a restart without gaps.
 */
export async function startSorobanEventListener(): Promise<void> {
  const contracts = buildContracts();

  if (contracts.length === 0) {
    logger.warn(
      'No contract IDs configured (ESCROW_CONTRACT_ID / PRODUCTION_ESCROW_CONTRACT_ID). ' +
      'Event listener will not start.',
    );
    return;
  }

  logger.info(
    `Soroban Event Listener starting — watching ${contracts.length} contract(s): ` +
    contracts.map((c) => c.label).join(', '),
  );

  const latestLedger = await server.getLatestLedger();
  // Per-contract high-watermark map to avoid replaying old events.
  const watermarks = new Map<string, number>(
    contracts.map((c) => [c.id, latestLedger.sequence]),
  );

  setInterval(async () => {
    for (const contract of contracts) {
      const lastLedger = watermarks.get(contract.id) ?? latestLedger.sequence;
      const newWatermark = await pollContract(contract, lastLedger);
      watermarks.set(contract.id, newWatermark);
    }
  }, 5_000);
}
