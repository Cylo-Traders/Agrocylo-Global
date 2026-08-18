import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { jsonValidated, validateBody, validateQuery } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { problemDetail } from '../middleware/errors.js';
import {
  createChallenge,
  verifySignatureAndCreateSession,
  verifyHandoffAndCreateSession,
  revokeSession,
  AuthError,
} from '../services/walletAuthService.js';

const router = Router();

const ChallengeRequestSchema = z.object({
  walletAddress: z.string().regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar address'),
});

const ChallengeResponseSchema = z.object({
  nonce: z.string(),
  expiresAt: z.string(),
});

const SessionRequestSchema = z.object({
  walletAddress: z.string().regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar address'),
  nonce: z.string(),
  signature: z.string().min(1, 'Signature is required'),
});

const SessionResponseSchema = z.object({
  accessToken: z.string(),
  sessionToken: z.string(),
  walletAddress: z.string(),
  expiresAt: z.string(),
});

const RevokeSessionBodySchema = z.object({
  sessionToken: z.string(),
});

const HandoffRequestSchema = z.object({
  token: z.string().min(1, 'Handoff token is required'),
});

// GET /auth/nonce?walletAddress=G...
router.get(
  '/auth/nonce',
  authLimiter,
  validateQuery(ChallengeRequestSchema),
  async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.query as unknown as { walletAddress: string };
      const result = await createChallenge(walletAddress);
      jsonValidated(res, ChallengeResponseSchema, 200, result);
    } catch (err) {
      if (err instanceof AuthError) {
        problemDetail(res, req, err.status, err.message);
        return;
      }
      problemDetail(res, req, 500, 'Internal Server Error', 'Failed to create challenge');
    }
  },
);

// POST /auth/session — verify signed nonce and issue session token
router.post(
  '/auth/session',
  authLimiter,
  validateBody(SessionRequestSchema),
  async (req: Request, res: Response) => {
    try {
      const { walletAddress, nonce, signature } = req.body as {
        walletAddress: string;
        nonce: string;
        signature: string;
      };
      const result = await verifySignatureAndCreateSession(walletAddress, nonce, signature);
      jsonValidated(res, SessionResponseSchema, 200, result);
    } catch (err) {
      if (err instanceof AuthError) {
        problemDetail(res, req, err.status, err.message);
        return;
      }
      problemDetail(res, req, 500, 'Internal Server Error', 'Failed to create session');
    }
  },
);

// POST /auth/handoff — verify a cross-app SSO handoff token minted by the
// root server and establish a session for the same wallet (Issue #686).
router.post(
  '/auth/handoff',
  authLimiter,
  validateBody(HandoffRequestSchema),
  async (req: Request, res: Response) => {
    try {
      const { token } = req.body as { token: string };
      const result = await verifyHandoffAndCreateSession(token);
      jsonValidated(res, SessionResponseSchema, 200, result);
    } catch (err) {
      if (err instanceof AuthError) {
        problemDetail(res, req, err.status, err.message);
        return;
      }
      problemDetail(res, req, 500, 'Internal Server Error', 'Failed to verify handoff token');
    }
  },
);

// POST /auth/revoke — revoke a session token
router.post(
  '/auth/revoke',
  authLimiter,
  validateBody(RevokeSessionBodySchema),
  async (req: Request, res: Response) => {
    try {
      const { sessionToken } = req.body as { sessionToken: string };
      await revokeSession(sessionToken);
      res.status(204).send();
    } catch (err) {
      problemDetail(res, req, 500, 'Internal Server Error', 'Failed to revoke session');
    }
  },
);

export default router;
