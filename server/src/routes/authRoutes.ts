import type { Request, Response } from 'express';
import { Router } from 'express';
import logger from '../config/logger.js';
import { ApiError, sendProblem } from '../http/errors.js';
import {
  generateNonce,
  verifySignature,
  refreshAccessToken,
  logout,
} from '../services/authService.js';

const router = Router();

// POST /auth/nonce
router.post('/nonce', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.body as { walletAddress?: string };
    if (!walletAddress) {
      return sendProblem(res, req, new ApiError(400, 'Bad Request', 'walletAddress is required'));
    }
    const data = await generateNonce(walletAddress);
    return res.status(200).json(data);
  } catch (err) {
    if (err instanceof ApiError) return sendProblem(res, req, err);
    logger.error('Nonce generation failed', err);
    return sendProblem(res, req, new ApiError(500, 'Internal Server Error', 'Unexpected error'));
  }
});

// POST /auth/verify
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { walletAddress, signature } = req.body as {
      walletAddress?: string;
      signature?: string;
    };
    if (!walletAddress || !signature) {
      return sendProblem(res, req, new ApiError(400, 'Bad Request', 'walletAddress and signature are required'));
    }
    logger.info('Signature verification requested', { walletAddress });
    const tokens = await verifySignature(walletAddress, signature);
    return res.status(200).json(tokens);
  } catch (err) {
    if (err instanceof ApiError) return sendProblem(res, req, err);
    logger.error('Signature verification failed', err);
    return sendProblem(res, req, new ApiError(500, 'Internal Server Error', 'Unexpected error'));
  }
});

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      return sendProblem(res, req, new ApiError(400, 'Bad Request', 'refreshToken is required'));
    }
    const data = await refreshAccessToken(refreshToken);
    return res.status(200).json(data);
  } catch (err) {
    if (err instanceof ApiError) return sendProblem(res, req, err);
    logger.error('Token refresh failed', err);
    return sendProblem(res, req, new ApiError(500, 'Internal Server Error', 'Unexpected error'));
  }
});

// DELETE /auth/logout
router.delete('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      return sendProblem(res, req, new ApiError(400, 'Bad Request', 'refreshToken is required'));
    }
    await logout(refreshToken);
    return res.status(204).send();
  } catch (err) {
    if (err instanceof ApiError) return sendProblem(res, req, err);
    logger.error('Logout failed', err);
    return sendProblem(res, req, new ApiError(500, 'Internal Server Error', 'Unexpected error'));
  }
});

export default router;
