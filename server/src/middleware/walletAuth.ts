import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/index.js";

export interface WalletRequest extends Request {
  walletAddress?: string;
}

interface TokenPayload {
  walletAddress?: string;
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
    req.walletAddress = decoded.walletAddress;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
}
