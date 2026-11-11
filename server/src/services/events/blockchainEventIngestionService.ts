import { BlockchainEventParser } from './blockchainEventParser.js';
import { BlockchainEventPersistenceService } from './blockchainEventPersistenceService.js';
import type { RawRpcEvent } from '../../types/rawRpcEvent.js';

export class BlockchainEventIngestionService {
  static async ingestEvent(rawEvent: RawRpcEvent): Promise<void> {
    const parsed = BlockchainEventParser.parse(rawEvent);
    if (!parsed) return;
    await BlockchainEventPersistenceService.persist(parsed);
  }
}
