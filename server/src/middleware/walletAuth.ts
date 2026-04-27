import type { NextFunction, Request, Response } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { Keypair } from "@stellar/stellar-sdk";

export interface WalletRequest extends Request {
  walletAddress?: string;
}

const EVM_WALLET_REGEX = /^0x[a-fA-F0-9]{40}$/;

function isStellarAddress(address: string): boolean {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
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
  const walletAddress = header.trim();
  const isEvmWallet = EVM_WALLET_REGEX.test(walletAddress);
  const isStellarWallet = isStellarAddress(walletAddress);

  if (!isEvmWallet && !isStellarWallet) {
    res.status(400).json({ message: 'Invalid wallet address format.' });
    return;
  }

  req.walletAddress = isEvmWallet
    ? walletAddress.toLowerCase()
    : walletAddress;
  next();
}
