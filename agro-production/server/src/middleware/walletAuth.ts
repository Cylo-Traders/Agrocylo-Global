import type { NextFunction, Request, Response } from 'express';
import {
  verifySession,
  verifySessionTokenSync,
  AuthError,
} from '../services/walletAuthService.js';

export interface WalletRequest extends Request {
  walletAddress?: string;
  sessionToken?: string;
}

export function requireWallet(
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.header('authorization');

  if (!authHeader) {
    res
      .status(401)
      .json({ message: 'Missing or invalid Authorization header' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res
      .status(401)
      .json({ message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = parts[1];

  // Try JWT verification first using the unified session token verifier (faster, no DB lookup)
  try {
    if (typeof verifySessionTokenSync === 'function') {
      const session = verifySessionTokenSync(token);
      req.walletAddress = session.walletAddress;
      if (session.sessionToken) {
        req.sessionToken = session.sessionToken;
      }
      next();
      return;
    }
  } catch (err: unknown) {
    if (
      err instanceof AuthError &&
      (err.message.startsWith('Invalid token:') ||
        err.message === 'Session token has expired.')
    ) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    // Not a valid JWT session token, try DB session token lookup
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
      res.status(401).json({ message: 'Invalid or expired token' });
    });
}
