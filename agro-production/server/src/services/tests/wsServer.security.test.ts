import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../config/index.js';
import {
  attachWebSocketServer,
  broadcast,
  broadcastTo,
  closeWebSocketServer,
} from '../wsServer.js';

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 400): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function authToken(walletAddress: string): string {
  return jwt.sign({ walletAddress, type: 'access' }, config.jwtSecret, {
    expiresIn: '1h',
  });
}

describe('WebSocket wallet scoping (#1441)', () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    attachWebSocketServer(httpServer);
    await new Promise<void>((resolve) =>
      httpServer.listen(0, () => {
        port = (httpServer.address() as { port: number }).port;
        resolve();
      }),
    );
  });

  afterEach(async () => {
    await closeWebSocketServer();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it('does not deliver private wallet-scoped events to unauthenticated clients', async () => {
    const unauth = await connectClient(port);
    const authed = await connectClient(port);
    authed.send(JSON.stringify({ type: 'auth', token: authToken('GWALLET1') }));

    const msgPromise = nextMessage(authed, 1000);
    broadcastTo('GWALLET1', 'order.created', {
      orderId: 'o1',
      campaignId: 'c1',
      amount: '100',
      status: 'PENDING',
      txHash: 'tx1',
    });

    const received = await msgPromise;
    expect(received.type).toBe('order.created');
    await expect(nextMessage(unauth, 300)).rejects.toThrow('timeout');
    unauth.close();
    authed.close();
  });

  it('delivers scoped event only to matching authenticated wallet', async () => {
    const a = await connectClient(port);
    const b = await connectClient(port);
    a.send(JSON.stringify({ type: 'auth', token: authToken('GWALLET_A') }));
    b.send(JSON.stringify({ type: 'auth', token: authToken('GWALLET_B') }));

    const aMsg = nextMessage(a, 1000);
    broadcastTo('GWALLET_A', 'campaign.invested', {
      campaignId: 'c1',
      amount: '10',
      txHash: 'tx-private',
    });

    expect((await aMsg).type).toBe('campaign.invested');
    await expect(nextMessage(b, 300)).rejects.toThrow('timeout');
    a.close();
    b.close();
  });

  it('allows sanitized public campaign events for unauthenticated clients', async () => {
    const unauth = await connectClient(port);
    const msg = nextMessage(unauth, 1000);
    broadcast('campaign.created', { campaignId: 'c1', tokenAddress: 'GTOKEN' });
    const received = await msg;
    expect(received.type).toBe('campaign.created');
    expect(received.payload).not.toHaveProperty('farmerAddress');
    unauth.close();
  });
});
