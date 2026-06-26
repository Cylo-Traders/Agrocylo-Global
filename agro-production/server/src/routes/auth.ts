import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { jsonValidated, validateBody } from '../middleware/validate.js';
import {
  createChallenge,
  verifySignatureAndCreateSession,
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
  sessionToken: z.string(),
  walletAddress: z.string(),
  expiresAt: z.string(),
});

const RevokeSessionBodySchema = z.object({
  sessionToken: z.string(),
});

// GET /auth/nonce?walletAddress=G...
router.get('/auth/nonce', async (req: Request, res: Response) => {
  try {
    const walletAddress = req.query['walletAddress'] as string;
    const parsed = ChallengeRequestSchema.parse({ walletAddress });
    const result = await createChallenge(parsed.walletAddress);
    jsonValidated(res, ChallengeResponseSchema, 200, result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ message: 'Invalid wallet address format.' });
      return;
    }
    res.status(500).json({ message: 'Failed to create challenge.' });
  }
});

// POST /auth/session — verify signed nonce and issue session token
router.post('/auth/session', async (req: Request, res: Response) => {
  try {
    const body = SessionRequestSchema.parse(req.body);
    const result = await verifySignatureAndCreateSession(
      body.walletAddress,
      body.nonce,
      body.signature,
    );
    jsonValidated(res, SessionResponseSchema, 200, result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ message: 'Invalid request body.', errors: err.errors });
      return;
    }
    res.status(500).json({ message: 'Failed to create session.' });
  }
});

// POST /auth/revoke — revoke a session token
router.post('/auth/revoke', async (req: Request, res: Response) => {
  try {
    const body = RevokeSessionBodySchema.parse(req.body);
    await revokeSession(body.sessionToken);
    res.status(204).send();
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ message: 'Invalid request body.' });
      return;
    }
    res.status(500).json({ message: 'Failed to revoke session.' });
  }
});

export default router;
