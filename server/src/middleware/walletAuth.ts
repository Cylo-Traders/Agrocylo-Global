import type { NextFunction, Request, Response } from 'express';

export interface WalletRequest extends Request {
  walletAddress?: string;
}

const EVM_WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;
const STELLAR_WALLET_REGEX = /^G[A-Z2-7]{55}$/;

function isValidWalletAddress(value: string): boolean {
  return EVM_WALLET_REGEX.test(value) || STELLAR_WALLET_REGEX.test(value);
}

export function requireWallet(req: WalletRequest, res: Response, next: NextFunction): void {
  const header = req.header('x-wallet-address');
  if (!header) {
    res.status(401).json({ message: 'Missing x-wallet-address header.' });
    return;
  }

  const walletAddress = header.trim();
  if (!isValidWalletAddress(walletAddress)) {
    res.status(400).json({ message: 'Invalid wallet address format.' });
    return;
  }

  req.walletAddress = walletAddress;
  next();
}
