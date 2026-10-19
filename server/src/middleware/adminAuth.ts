import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken } from '../services/authService';

const prisma = new PrismaClient();

/**
 * Canonicalize a Stellar wallet address for case-insensitive comparison.
 * Stellar addresses are checksummed mixed-case, but persisted values are
 * canonical-lowercase, so all comparisons must be done on the lowercase form.
 */
function canonicalizeWallet(address: string | undefined | null): string {
  return (address ?? '').trim().toLowerCase();
}

/**
 * Middleware to require admin authentication
 * Checks JWT token and verifies user has admin role
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const walletAddress = canonicalizeWallet(payload.walletAddress);

    if (!walletAddress) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }

    // Check if wallet is in the ADMIN_WALLETS environment variable
    const adminWallets = (process.env.ADMIN_WALLETS || '')
      .split(',')
      .map((w) => canonicalizeWallet(w))
      .filter((w) => w.length > 0);

    if (adminWallets.includes(walletAddress)) {
      (req as any).user = { walletAddress, role: 'ADMIN' };
      next();
      return;
    }

    // Check database for user role (canonical-lowercase lookup)
    const user = await prisma.user.findFirst({
      where: {
        walletAddress: {
          equals: walletAddress,
          mode: 'insensitive',
        },
      },
      select: { role: true },
    });

    if (!user || user.role !== 'ADMIN') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    (req as any).user = { walletAddress, role: user.role };
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
