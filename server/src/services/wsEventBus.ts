import { Redis } from 'ioredis';
import { createRedisConnection } from '../queues/connection.js';
import logger from '../config/logger.js';

const CHANNEL = 'agrocylo:websocket-events:v1';

export interface WsEventMessage {
  event: string;
  data: unknown;
  wallets?: string[];
}

export interface WsEventDispatcher {
  broadcast(event: string, data: unknown): void;
  broadcastTo(wallet: string, event: string, data: unknown): void;
}

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

function redisClient(): Redis {
  const client = new Redis(createRedisConnection());
  client.on('error', (error) => logger.error('WebSocket event Redis error', error));
  return client;
}

export async function publishWsEvent(message: WsEventMessage): Promise<void> {
  publisher ??= redisClient();
  await publisher.publish(CHANNEL, JSON.stringify(message));
}

export function dispatchWsEvent(dispatcher: WsEventDispatcher, message: WsEventMessage): void {
  if (message.wallets?.length) {
    for (const wallet of message.wallets) {
      dispatcher.broadcastTo(wallet, message.event, message.data);
    }
    return;
  }
  dispatcher.broadcast(message.event, message.data);
}

export async function subscribeWsEvents(dispatcher: WsEventDispatcher): Promise<void> {
  if (subscriber) return;
  const client = redisClient();
  subscriber = client;
  client.on('message', (channel, payload) => {
    if (channel !== CHANNEL) return;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('event' in parsed) ||
        typeof parsed.event !== 'string' ||
        !('data' in parsed) ||
        ('wallets' in parsed &&
          (!Array.isArray(parsed.wallets) ||
            parsed.wallets.some((wallet) => typeof wallet !== 'string')))
      ) {
        logger.warn('Ignoring invalid WebSocket event payload from Redis');
        return;
      }
      dispatchWsEvent(dispatcher, parsed as WsEventMessage);
    } catch (error) {
      logger.warn('Ignoring malformed WebSocket event payload from Redis', error);
    }
  });
  try {
    await client.subscribe(CHANNEL);
  } catch (error) {
    subscriber = null;
    await client.quit();
    throw error;
  }
}

export async function closeWsEventBus(): Promise<void> {
  const clients = [publisher, subscriber].filter((client): client is Redis => client !== null);
  publisher = null;
  subscriber = null;
  await Promise.allSettled(clients.map((client) => client.quit()));
}
