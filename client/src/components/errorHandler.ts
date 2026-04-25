export type BlockchainErrorKind = 'insufficient_balance' | 'user_rejected' | 'network_unavailable' | 'unknown';

export interface BlockchainErrorInfo {
  kind: BlockchainErrorKind;
  title: string;
  message: string;
  action: string;
}

const standardErrors: Record<BlockchainErrorKind, BlockchainErrorInfo> = {
  insufficient_balance: {
    kind: 'insufficient_balance',
    title: 'Insufficient Balance',
    message: 'Your wallet does not have enough funds to complete this transaction. Please top up your balance and try again.',
    action: 'Check wallet balance and re-submit transaction',
  },
  user_rejected: {
    kind: 'user_rejected',
    title: 'Transaction Rejected',
    message: 'You rejected the transaction in your wallet provider. Confirm the transaction to proceed.',
    action: 'Approve the transaction in your wallet',
  },
  network_unavailable: {
    kind: 'network_unavailable',
    title: 'Network Unavailable',
    message: 'There was a problem communicating with the blockchain network. Please check your connection and try again.',
    action: 'Retry transaction or check network settings',
  },
  unknown: {
    kind: 'unknown',
    title: 'Unknown Error',
    message: 'An unexpected error occurred while processing your request.',
    action: 'Inspect error details and contact support if needed',
  },
};

const fromError = (err: unknown): string => {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;

  try {
    return JSON.stringify(err, Object.getOwnPropertyNames(err));
  } catch {
    return String(err);
  }
};

export function mapBlockchainError(error: unknown): BlockchainErrorInfo {
  const raw = fromError(error).toLowerCase();

  if (!raw) return standardErrors.unknown;

  if (raw.includes('insufficient funds') || raw.includes('insufficient balance') || raw.includes('balance too low')) {
    return standardErrors.insufficient_balance;
  }

  if (raw.includes('user rejected') || raw.includes('denied transaction') || raw.includes('user denied') || raw.includes('rejected by user') || raw.includes('transaction rejected')) {
    return standardErrors.user_rejected;
  }

  if (raw.includes('rpc') || raw.includes('network') || raw.includes('timeout') || raw.includes('connection error') || raw.includes('network unavailable')) {
    return standardErrors.network_unavailable;
  }

  return standardErrors.unknown;
}