import type { NextFunction, Response } from 'express';
import { prisma } from '../db/client.js';
import type { WalletRequest } from './walletAuth.js';

export interface RoleRequest extends WalletRequest {
  role?: string;
}

/**
 * Role gate. Must run after `requireWallet`: the wallet is taken from the
 * verified session (`req.walletAddress`), never from a client-supplied header
 * (Issue #1206). An `x-wallet-address` header is tolerated only as a
 * cross-check and must match the authenticated wallet.
 */
export function requireRole(requiredRole: string) {
  return async (req: RoleRequest, res: Response, next: NextFunction): Promise<void> => {
    const walletAddress = req.walletAddress;
    if (!walletAddress) {
      res.status(401).json({ message: 'Authentication required.' });
      return;
    }

    const claimedWallet = req.header('x-wallet-address');
    if (claimedWallet && claimedWallet !== walletAddress) {
      res.status(403).json({ message: 'x-wallet-address does not match the authenticated wallet' });
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { walletAddress },
        select: { role: true },
      });

      if (!user || user.role !== requiredRole) {
        res.status(403).json({ message: `${requiredRole} access required` });
        return;
      }

      req.role = user.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}
