import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";
import { HANDOFF_AUDIENCE } from "../services/authService.js";

export interface WalletRequest extends Request {
  walletAddress?: string;
}

interface TokenPayload {
  walletAddress?: string;
  aud?: string;
}

export function requireWallet(req: WalletRequest, res: Response, next: NextFunction): void {
  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing or invalid Authorization header.' });
    return;
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  if (!config.jwtSecret) {
    res.status(500).json({ message: 'Server configuration error: JWT secret is not set.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload;
    if (!decoded.walletAddress) {
      res.status(401).json({ message: 'Invalid token: missing walletAddress.' });
      return;
    }
    // A cross-app SSO handoff token (Issue #686) is single-purpose: it may
    // only be redeemed via POST /auth/handoff, never used directly as a
    // general session credential.
    if (decoded.aud === HANDOFF_AUDIENCE) {
      res.status(401).json({ message: 'Invalid token: not a session token.' });
      return;
    }
    req.walletAddress = decoded.walletAddress;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
}
