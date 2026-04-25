import type { NextFunction, Request, Response } from 'express';
import { Keypair } from '@stellar/stellar-sdk';

export interface WalletRequest extends Request {
  walletAddress?: string;
}

export function requireWallet(req: WalletRequest, res: Response, next: NextFunction): void {
  const header = req.header('x-wallet-address');
  if (!header) {
    res.status(401).json({ message: 'Missing x-wallet-address header.' });
    return;
  }

  try {
    Keypair.fromPublicKey(header);
  } catch {
    res.status(400).json({ message: 'Invalid Stellar wallet address format.' });
    return;
  }

  req.walletAddress = header;
  next();
}
