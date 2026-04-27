import type { NextFunction, Request, Response } from 'express';

export interface WalletRequest extends Request {
  walletAddress?: string;
}

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export function requireWallet(
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.header('x-wallet-address');
  if (!header) {
    res.status(401).json({ message: 'Missing x-wallet-address header.' });
    return;
  }

  if (!STELLAR_ADDRESS_REGEX.test(header)) {
    res.status(400).json({ message: 'Invalid Stellar wallet address format.' });
    return;
  }

  req.walletAddress = header;
  next();
}
