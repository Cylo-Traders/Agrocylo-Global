import type { NextFunction, Request, Response } from 'express';

export interface WalletRequest extends Request {
  walletAddress?: string;
}

const WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function requireWallet(req: WalletRequest, res: Response, next: NextFunction): void {
  const header = req.header('x-wallet-address');
  if (!header) {
    res.status(401).json({ message: 'Missing x-wallet-address header.' });
    return;
  }

  const walletAddress = header.toLowerCase();
  if (!WALLET_REGEX.test(walletAddress)) {
    res.status(400).json({ message: 'Invalid wallet address format.' });
    return;
  }

  req.walletAddress = walletAddress;
  next();
}
