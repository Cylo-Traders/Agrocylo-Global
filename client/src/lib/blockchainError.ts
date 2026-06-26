export type ErrorKind =
  | "network"
  | "authentication"
  | "validation"
  | "blockchain"
  | "wallet"
  | "unknown";

export type BlockchainErrorKind =
  | "insufficient_balance"
  | "user_rejected"
  | "network_unavailable"
  | "unknown";

export interface ErrorInfo {
  kind: ErrorKind;
  title: string;
  message: string;
  action: string;
  documentationUrl?: string;
}

export interface BlockchainErrorInfo {
  kind: BlockchainErrorKind;
  title: string;
  message: string;
  action: string;
}

const standardErrors: Record<BlockchainErrorKind, BlockchainErrorInfo> = {
  insufficient_balance: {
    kind: "insufficient_balance",
    title: "Insufficient Balance",
    message:
      "Your wallet does not have enough funds to complete this transaction. Please top up your balance and try again.",
    action: "Check wallet balance and re-submit transaction",
  },
  user_rejected: {
    kind: "user_rejected",
    title: "Transaction Rejected",
    message:
      "You rejected the transaction in your wallet provider. Confirm the transaction to proceed.",
    action: "Approve the transaction in your wallet",
  },
  network_unavailable: {
    kind: "network_unavailable",
    title: "Network Unavailable",
    message:
      "There was a problem communicating with the blockchain network. Please check your connection and try again.",
    action: "Retry transaction or check network settings",
  },
  unknown: {
    kind: "unknown",
    title: "Unknown Error",
    message:
      "An unexpected error occurred while processing your request.",
    action: "Inspect error details and contact support if needed",
  },
};

const errorCatalog: Record<ErrorKind, ErrorInfo> = {
  network: {
    kind: "network",
    title: "Network Error",
    message:
      "Unable to reach the server. Please check your internet connection and try again.",
    action: "Check your connection and retry",
  },
  authentication: {
    kind: "authentication",
    title: "Authentication Error",
    message:
      "Your session may have expired. Please reconnect your wallet and try again.",
    action: "Reconnect your wallet",
  },
  validation: {
    kind: "validation",
    title: "Validation Error",
    message:
      "The provided information is invalid. Please check your input and try again.",
    action: "Review and correct the highlighted fields",
  },
  blockchain: {
    kind: "blockchain",
    title: "Blockchain Error",
    message:
      "The blockchain transaction failed. This could be due to network congestion or invalid parameters.",
    action: "Wait a moment and try again",
  },
  wallet: {
    kind: "wallet",
    title: "Wallet Error",
    message:
      "There was an issue with your wallet. Please make sure it is unlocked and connected.",
    action: "Unlock your wallet and try again",
  },
  unknown: {
    kind: "unknown",
    title: "Unexpected Error",
    message:
      "An unexpected error occurred. Please try again or contact support if the issue persists.",
    action: "Try again or contact support",
  },
};

const fromError = (err: unknown): string => {
  if (!err) return "";
  if (typeof err === "string") return err;
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

  if (
    raw.includes("insufficient funds") ||
    raw.includes("insufficient balance") ||
    raw.includes("balance too low")
  ) {
    return standardErrors.insufficient_balance;
  }

  if (
    raw.includes("user rejected") ||
    raw.includes("denied transaction") ||
    raw.includes("user denied") ||
    raw.includes("rejected by user") ||
    raw.includes("transaction rejected")
  ) {
    return standardErrors.user_rejected;
  }

  if (
    raw.includes("rpc") ||
    raw.includes("network") ||
    raw.includes("timeout") ||
    raw.includes("connection error") ||
    raw.includes("network unavailable")
  ) {
    return standardErrors.network_unavailable;
  }

  return standardErrors.unknown;
}

export function classifyError(error: unknown): ErrorInfo {
  const raw = fromError(error).toLowerCase();
  if (!raw) return errorCatalog.unknown;

  if (
    raw.includes("network") ||
    raw.includes("timeout") ||
    raw.includes("fetch") ||
    raw.includes("abort") ||
    raw.includes("econnrefused") ||
    raw.includes("econnreset") ||
    raw.includes("enotfound")
  ) {
    return errorCatalog.network;
  }

  if (
    raw.includes("auth") ||
    raw.includes("unauthorized") ||
    raw.includes("unauthenticated") ||
    raw.includes("session") ||
    raw.includes("token") ||
    raw.includes("login") ||
    raw.includes("permission")
  ) {
    return errorCatalog.authentication;
  }

  if (
    raw.includes("validation") ||
    raw.includes("invalid") ||
    raw.includes("required") ||
    raw.includes("malformed") ||
    raw.includes("does not match")
  ) {
    return errorCatalog.validation;
  }

  if (
    raw.includes("wallet") ||
    raw.includes("freighter") ||
    raw.includes("xbull") ||
    raw.includes("rabet") ||
    raw.includes("connect") ||
    raw.includes("sign")
  ) {
    return errorCatalog.wallet;
  }

  if (
    raw.includes("contract") ||
    raw.includes("soroban") ||
    raw.includes("stellar") ||
    raw.includes("xlm") ||
    raw.includes("transaction") ||
    raw.includes("insufficient") ||
    raw.includes("op underfunded") ||
    raw.includes("bad sequence")
  ) {
    return errorCatalog.blockchain;
  }

  return errorCatalog.unknown;
}
