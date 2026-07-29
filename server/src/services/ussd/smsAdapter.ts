import logger from "../../config/logger.js";

export interface SmsProvider {
  send(phoneNumber: string, message: string): Promise<void>;
}

class LoggingSmsProvider implements SmsProvider {
  async send(phoneNumber: string, message: string): Promise<void> {
    logger.info(`[SMS] To: ${phoneNumber} | Message: ${message}`);
  }
}

let provider: SmsProvider = new LoggingSmsProvider();

export function setSmsProvider(p: SmsProvider): void {
  provider = p;
}

export async function sendSms(phoneNumber: string, message: string): Promise<void> {
  await provider.send(phoneNumber, message);
}
