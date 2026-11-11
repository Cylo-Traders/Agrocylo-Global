import { EscrowEventParser } from './escrowEventParser.js';
import { EscrowEventMapper } from './escrowEventMapper.js';
import { EscrowEventRepository } from './escrowEventRepository.js';
import { EscrowEventProjectionService } from './escrowEventProjectionService.js';
import { NotificationService } from '../notificationService.js';
import logger from '../../config/logger.js';
import type { RawRpcEvent } from '../../types/rawRpcEvent.js';

/**
 * EscrowEventIngestionService: The public entrypoint for processing each event.
 */
export class EscrowEventIngestionService {
  /**
   * Main flow to ingest a single raw event.
   * Throws on failure so the contract-watcher can retry the ledger.
   */
  static async ingestEvent(rawEvent: RawRpcEvent) {
    // 1. Parse
    const parsed = EscrowEventParser.parse(rawEvent);
    logger.info(`Processing ${parsed.action} event for order ${parsed.orderId}`);

    // 2. Map
    const mapped = EscrowEventMapper.mapToModel(parsed);

    // 3. Persist
    const record = await EscrowEventRepository.createEscrowEvent(mapped);
    logger.info(`Escrow event stored in DB: ${record.id}`);

    // 4. Project to Application Domain
    await EscrowEventProjectionService.projectEvent(mapped);

    // 5. Notification System for Disputes
    if (mapped.action === 'dispute' || mapped.action === 'resolved') {
      await NotificationService.notifyOrderEvent(
        mapped.action === 'dispute' ? 'dispute_opened' : 'dispute_resolved',
        mapped
      );
    }

    return record;
  }
}
