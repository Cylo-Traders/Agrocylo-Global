import { SocketService } from "./socketService.js";
import logger from "../config/logger.js";

export class NotificationService {
  /**
   * Notify users about order-related events.
   * @param event The event type (e.g., 'dispute_opened', 'dispute_resolved')
   * @param data The payload for the notification
   */
  public static async notifyOrderEvent(event: string, data: any) {
    logger.info(`[NotificationService]: Sending notification for event: ${event}`);
    
    // Emit via WebSocket
    SocketService.emit(event, data);

    // Future extension: Add logic to send emails, push notifications, etc.
  }
}
