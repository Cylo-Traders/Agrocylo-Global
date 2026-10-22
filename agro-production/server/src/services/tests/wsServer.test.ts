import { createServer } from 'http';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config/index.js';
import { HANDOFF_AUDIENCE } from '../walletAuthService.js';
import {
  attachWebSocketServer,
  broadcast,
  closeWebSocketServer,
} from '../wsServer.js';

const { mockAuthNonceFindUnique } = vi.hoisted(() => ({
  mockAuthNonceFindUnique: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  prisma: {
    authNonce: {
      findUnique: mockAuthNonceFindUnique,
    },
  },
}));

function connectClient(port: number, path?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}${path ?? '/ws'}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('close', (code) => resolve(code));
  });
}

function nextMessage(
  ws: WebSocket,
): Promise<{
  version: string;
  type: string;
  payload: unknown;
  timestamp: string;
}> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('No message received within 2s')),
      2000,
    );
    ws.once('message', (data) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

describe('WebSocket server (functional)', () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    attachWebSocketServer(httpServer);
    await new Promise<void>((resolve) =>
      httpServer.listen(0, () => {
        const addr = httpServer.address() as { port: number };
        port = addr.port;
        resolve();
      }),
    );
  });

  afterEach(async () => {
    await closeWebSocketServer();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it('broadcasts correct envelope shape to connected client', async () => {
    const client = await connectClient(port);
    const msgPromise = nextMessage(client);

    broadcast('campaign.created', {
      id: '1',
      farmerAddress: 'G...',
      tokenAddress: 'G...',
    });

    const envelope = await msgPromise;
    expect(envelope.version).toBe('1');
    expect(envelope.type).toBe('campaign.created');
    expect(envelope.payload).toMatchObject({ id: '1' });
    expect(typeof envelope.timestamp).toBe('string');
    client.close();
  });

  it('broadcasts to all connected clients', async () => {
    const [c1, c2] = await Promise.all([
      connectClient(port),
      connectClient(port),
    ]);

    const msg1 = nextMessage(c1);
    const msg2 = nextMessage(c2);

    broadcast('campaign.invested', {
      campaignId: '1',
      investorAddress: 'G...',
      amount: '100',
      totalRaised: '200',
    });

    const results = await Promise.all([msg1, msg2]);
    expect(results).toHaveLength(2);
    results.forEach((msg) => expect(msg.type).toBe('campaign.invested'));
    c1.close();
    c2.close();
  });

  it('broadcast does not throw when no clients connected', () => {
    expect(() =>
      broadcast('campaign.invested', {
        campaignId: '1',
        investorAddress: 'G...',
        amount: '100',
        totalRaised: '200',
      }),
    ).not.toThrow();
  });

  it('closeWebSocketServer resolves', async () => {
    await closeWebSocketServer();
    // Should not throw
  });

  describe('WebSocket server authentication (Issue #1252)', () => {
    const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    it('authenticates successfully with a valid session token', async () => {
      const token = jwt.sign(
        { walletAddress: WALLET, role: 'USER' },
        config.jwtSecret,
        {
          expiresIn: '15m',
        },
      );
      const client = await connectClient(port);
      client.send(JSON.stringify({ type: 'auth', token }));

      await new Promise((r) => setTimeout(r, 60));
      expect(client.readyState).toBe(WebSocket.OPEN);
      client.close();
    });

    it('authenticates successfully with an allowed audience', async () => {
      const token = jwt.sign(
        { walletAddress: WALLET, role: 'FARMER' },
        config.jwtSecret,
        {
          expiresIn: '15m',
          audience: 'agro-production',
        },
      );
      const client = await connectClient(port);
      client.send(JSON.stringify({ type: 'auth', token }));

      await new Promise((r) => setTimeout(r, 60));
      expect(client.readyState).toBe(WebSocket.OPEN);
      client.close();
    });

    it('authenticates successfully with an opaque DB session token', async () => {
      const sessionToken = 'session-test-token-uuid';
      mockAuthNonceFindUnique.mockResolvedValueOnce({
        id: 'nonce-1',
        walletAddress: WALLET,
        nonce: sessionToken,
        audience: 'session',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const client = await connectClient(port);
      client.send(JSON.stringify({ type: 'auth', token: sessionToken }));

      await new Promise((r) => setTimeout(r, 60));
      expect(client.readyState).toBe(WebSocket.OPEN);
      client.close();
    });

    it('rejects unredeemed SSO handoff tokens during WebSocket authentication', async () => {
      const handoffToken = jwt.sign(
        { walletAddress: WALLET },
        config.jwtSecret,
        {
          expiresIn: '60s',
          audience: HANDOFF_AUDIENCE,
          jwtid: 'handoff-jti-1',
        },
      );

      const client = await connectClient(port);
      const closePromise = waitForClose(client);

      client.send(JSON.stringify({ type: 'auth', token: handoffToken }));

      const code = await closePromise;
      expect(code).toBe(4001);
    });

    it('rejects redeemed handoff tokens (jti in DB) during WebSocket authentication', async () => {
      const redeemedJti = 'consumed-handoff-jti';
      mockAuthNonceFindUnique.mockResolvedValueOnce({
        id: 'nonce-2',
        walletAddress: WALLET,
        nonce: redeemedJti,
        audience: 'sso-handoff',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      const client = await connectClient(port);
      const closePromise = waitForClose(client);

      client.send(JSON.stringify({ type: 'auth', token: redeemedJti }));

      const code = await closePromise;
      expect(code).toBe(4001);
    });

    it('rejects tokens with wrong audience claim', async () => {
      const wrongAudToken = jwt.sign(
        { walletAddress: WALLET },
        config.jwtSecret,
        {
          expiresIn: '15m',
          audience: 'unauthorized-external-service',
        },
      );

      const client = await connectClient(port);
      const closePromise = waitForClose(client);

      client.send(JSON.stringify({ type: 'auth', token: wrongAudToken }));

      const code = await closePromise;
      expect(code).toBe(4001);
    });

    it('rejects tokens with missing walletAddress', async () => {
      const missingWalletToken = jwt.sign({ role: 'USER' }, config.jwtSecret, {
        expiresIn: '15m',
      });

      const client = await connectClient(port);
      const closePromise = waitForClose(client);

      client.send(JSON.stringify({ type: 'auth', token: missingWalletToken }));

      const code = await closePromise;
      expect(code).toBe(4001);
    });

    it('rejects tokens with invalid role', async () => {
      const invalidRoleToken = jwt.sign(
        { walletAddress: WALLET, role: 'UNSUPPORTED_ROLE' },
        config.jwtSecret,
        { expiresIn: '15m' },
      );

      const client = await connectClient(port);
      const closePromise = waitForClose(client);

      client.send(JSON.stringify({ type: 'auth', token: invalidRoleToken }));

      const code = await closePromise;
      expect(code).toBe(4001);
    });

    it('rejects tokens with invalid type', async () => {
      const invalidTypeToken = jwt.sign(
        { walletAddress: WALLET, type: 'refresh' },
        config.jwtSecret,
        { expiresIn: '15m' },
      );

      const client = await connectClient(port);
      const closePromise = waitForClose(client);

      client.send(JSON.stringify({ type: 'auth', token: invalidTypeToken }));

      const code = await closePromise;
      expect(code).toBe(4001);
    });

    it('rejects expired tokens', async () => {
      const expiredToken = jwt.sign(
        { walletAddress: WALLET, role: 'USER' },
        config.jwtSecret,
        { expiresIn: '-1s' },
      );

      const client = await connectClient(port);
      const closePromise = waitForClose(client);

      client.send(JSON.stringify({ type: 'auth', token: expiredToken }));

      const code = await closePromise;
      expect(code).toBe(4001);
    });

    it('closes connection with 4001 on non-JSON messages', async () => {
      const client = await connectClient(port);
      const closePromise = waitForClose(client);

      client.send('not-valid-json');

      const code = await closePromise;
      expect(code).toBe(4001);
    });

    it('ignores non-auth messages without closing', async () => {
      const client = await connectClient(port);

      client.send(JSON.stringify({ type: 'ping' }));
      await new Promise((r) => setTimeout(r, 60));

      expect(client.readyState).toBe(WebSocket.OPEN);
      client.close();
    });
  });
});
