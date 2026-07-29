import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { verifySession, AuthError } from '../services/walletAuthService.js';
import { config } from '../config/index.js';

export interface WalletRequest extends Request {
  walletAddress?: string;
  sessionToken?: string;
}

interface JWTPayload {
  walletAddress: string;
  role?: string;
}

export function requireWallet(
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.header('authorization');

  if (!authHeader) {
    res.status(401).json({ message: 'Authentication required. Provide Authorization: Bearer <token>.' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ message: 'Invalid Authorization header format. Expected: Bearer <token>.' });
    return;
  }

  const token = parts[1];

  // Try JWT verification first (faster, no DB lookup)
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JWTPayload;
    if (!decoded.walletAddress) {
      res.status(401).json({ message: 'Invalid token: missing walletAddress.' });
      return;
    }
    req.walletAddress = decoded.walletAddress;
    next();
    return;
  } catch {
    // Not a valid JWT, try session token lookup
  }

  // Fall back to session token verification (for backward compatibility)
  verifySession(token)
    .then((session) => {
      req.walletAddress = session.walletAddress;
      req.sessionToken = session.sessionToken;
      next();
    })
    .catch((err: unknown) => {
      if (err instanceof AuthError) {
        res.status(err.status).json({ message: err.message });
        return;
      }
      res.status(401).json({ message: 'Authentication failed.' });
    });
}
