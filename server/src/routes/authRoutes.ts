import type { Request, Response } from 'express';
import { Router } from 'express';
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
    console.error('nonce error:', err);
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
    console.log('calling verifySignature with', walletAddress, signature);
    const tokens = await verifySignature(walletAddress, signature);
    return res.status(200).json(tokens);
  } catch (err) {
    console.error('verify error:', err);
    if (err instanceof ApiError) return sendProblem(res, req, err);
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
    console.error('refresh error:', err);
    if (err instanceof ApiError) return sendProblem(res, req, err);
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
    console.error('logout error:', err);
    if (err instanceof ApiError) return sendProblem(res, req, err);
    return sendProblem(res, req, new ApiError(500, 'Internal Server Error', 'Unexpected error'));
  }
});

export default router;
