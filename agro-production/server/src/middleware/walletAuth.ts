import type { NextFunction, Request, Response } from 'express';
import { verifySession, AuthError } from '../services/walletAuthService.js';

export interface WalletRequest extends Request {
  walletAddress?: string;
  sessionToken?: string;
}

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

function isProtectedMethod(method: string): boolean {
  return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase());
}

export function requireWallet(
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.header('authorization');
  const walletHeader = req.header('x-wallet-address');

  // Session token via Authorization header
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const sessionToken = parts[1];
      verifySession(sessionToken)
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
      return;
    }
  }

  // Legacy x-wallet-address header — only allow for read operations
  if (!isProtectedMethod(req.method) && walletHeader) {
    if (!STELLAR_ADDRESS_REGEX.test(walletHeader)) {
      res.status(400).json({ message: 'Invalid Stellar wallet address format.' });
      return;
    }
    req.walletAddress = walletHeader;
    next();
    return;
  }

  // Mutations require signed auth
  if (isProtectedMethod(req.method)) {
    res.status(401).json({
      message: 'Authentication required. Provide Authorization: Bearer <session_token> for mutations.',
    });
    return;
  }

  res.status(401).json({ message: 'Missing x-wallet-address header.' });
}
