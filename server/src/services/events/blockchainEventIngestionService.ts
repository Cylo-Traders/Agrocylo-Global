import logger from "../../config/logger.js";
import { BlockchainEventParser } from "./blockchainEventParser.js";
import { BlockchainEventPersistenceService } from "./blockchainEventPersistenceService.js";
import type { RawRpcEvent } from "../../types/rawRpcEvent.js";

export class BlockchainEventIngestionService {
  static async ingestEvent(rawEvent: RawRpcEvent): Promise<void> {
    try {
      const parsed = BlockchainEventParser.parse(rawEvent);
      if (!parsed) return;
      await BlockchainEventPersistenceService.persist(parsed);
    } catch (error) {
      logger.error("Failed to ingest blockchain event", { error, rawEvent });
    }
  }
}
