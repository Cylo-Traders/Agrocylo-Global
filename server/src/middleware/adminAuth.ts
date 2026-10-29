import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { prisma } from '../config/database.js';
import logger from '../config/logger.js';

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

    // DB cross-check: verify the wallet still holds the ADMIN role
    prisma.user
      .findUnique({ where: { walletAddress: decoded.walletAddress }, select: { role: true } })
      .then((user) => {
        if (!user || user.role !== 'ADMIN') {
          logger.warn('[requireAdmin] Stale admin JWT rejected — role not found in DB', {
            walletAddress: decoded.walletAddress,
            dbRole: user?.role ?? null,
          });
          res.status(403).json({ message: 'Forbidden: Admin privileges have been revoked.' });
          return;
        }
        next();
      })
      .catch((err) => {
        logger.error('[requireAdmin] Failed to verify admin role against DB', { error: err });
        res.status(500).json({ message: 'Internal Server Error: could not verify admin role.' });
      });
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
}
