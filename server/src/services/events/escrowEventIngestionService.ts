import { EscrowEventParser } from "./escrowEventParser.js";
import { EscrowEventMapper } from "./escrowEventMapper.js";
import { EscrowEventRepository } from "./escrowEventRepository.js";
import { EscrowEventProjectionService } from "./escrowEventProjectionService.js";
import logger from "../../config/logger.js";

/**
 * EscrowEventIngestionService: The public entrypoint for processing each event.
 */
export class EscrowEventIngestionService {
  /**
   * Main flow to ingest a single raw event.
   */
  static async ingestEvent(rawEvent: any) {
    try {
      // 1. Parse
      const parsed = EscrowEventParser.parse(rawEvent);
      logger.info(`Processing ${parsed.action} event for order ${parsed.orderId}`);

      // 2. Map
      const mapped = EscrowEventMapper.mapToModel(parsed);

      // 3. Persist
      const record = await EscrowEventRepository.createEscrowEvent(mapped);
      logger.info(`Escrow event stored in DB: ${record.id}`);

      // --- NEW: Project to Application Domain (Issue #44) ---
      await EscrowEventProjectionService.projectEvent(record);

      return record;
    } catch (error) {
      // Structured logging without crashing the whole process
      logger.error(`Failed to ingest event:`, error);
      return null;
    }
  }
}
