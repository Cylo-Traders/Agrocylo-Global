import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AdminRequest extends Request {
  adminWallet?: string;
}

interface AdminJwtPayload {
  walletAddress: string;
  role: string;
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Missing or malformed Authorization header.' });
    return;
  }
  const token = authHeader.split(' ')[1] ?? '';
  try {
    const decoded = jwt.verify(token, String(config.jwtSecret)) as unknown as AdminJwtPayload;
    if (decoded.role !== 'ADMIN') {
      res.status(403).json({ message: 'Forbidden: Admin access required.' });
      return;
    }
    req.adminWallet = decoded.walletAddress;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
}
