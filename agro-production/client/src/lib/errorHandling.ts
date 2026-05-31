import { ApiError, NetworkError } from "@/lib/apiClient";
import { captureError } from "@/lib/errorTracking";

export type ErrorCategory = "wallet" | "network" | "contract" | "validation" | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  rawMessage: string;
  actionableMessage: string;
}

export interface ErrorContext {
  feature: string;
  action: string;
  [key: string]: unknown;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function classifyCategory(error: unknown, fallbackMessage?: string): ErrorCategory {
  const message = (fallbackMessage ?? toMessage(error)).toLowerCase();
  if (error instanceof NetworkError || error instanceof ApiError || message.includes("network") || message.includes("timed out") || message.includes("fetch")) {
    return "network";
  }
  if (message.includes("freighter") || message.includes("wallet") || message.includes("rejected by wallet") || message.includes("user declined")) {
    return "wallet";
  }
  if (message.includes("invalid") || message.includes("required") || message.includes("must be") || message.includes("format")) {
    return "validation";
  }
  if (message.includes("contract") || message.includes("simulation failed") || message.includes("on-chain") || message.includes("soroban") || message.includes("submission failed")) {
    return "contract";
  }
  return "unknown";
}

function fallbackActionableMessage(category: ErrorCategory): string {
  switch (category) {
    case "network":
      return "We could not reach the server. Check your internet connection and try again.";
    case "wallet":
      return "Wallet action was not completed. Re-open your wallet and approve the request.";
    case "contract":
      return "The blockchain transaction could not be completed. Try again in a moment and verify network settings.";
    case "validation":
      return "Some input is invalid. Review the highlighted fields and try again.";
    default:
      return "Something went wrong. Please try again, and contact support if it continues.";
  }
}

const CONTEXT_MESSAGES: Record<string, Partial<Record<ErrorCategory, string>>> = {
  loadCampaign: {
    network: "Could not load this campaign because the network is unavailable. Check your connection and refresh.",
    validation: "This campaign request appears invalid. Verify the campaign link and try again.",
    unknown: "Could not load this campaign. Refresh the page and try again.",
  },
  loadCampaigns: {
    network: "Could not load campaigns due to a network issue. Check your connection and retry.",
    unknown: "Could not load campaigns. Refresh the page to try again.",
  },
  recordOrder: {
    validation: "Order details are invalid. Recheck your wallet address and amount before submitting.",
    network: "Could not record your order because the API is unreachable. Please try again.",
    unknown: "Could not record your order. Try again in a few seconds.",
  },
  buildOrderTransaction: {
    contract: "Could not prepare the escrow transaction. Confirm contract configuration and retry.",
    validation: "Transaction details are invalid. Verify campaign data and amount, then retry.",
    unknown: "Could not prepare the order transaction. Please try again.",
  },
  submitOrderTransaction: {
    wallet: "Transaction was not signed in your wallet. Open your wallet and approve the request.",
    network: "Transaction could not be submitted due to a network issue. Check connectivity and retry.",
    contract: "Transaction was rejected on-chain. Retry after a moment or verify contract state.",
    unknown: "Transaction failed to submit. Please try again.",
  },
  invest: {
    validation: "Investment amount is invalid. Enter a valid amount and retry.",
    network: "Investment request failed due to a network issue. Check your connection and try again.",
    unknown: "Investment request failed. Please try again.",
  },
};

export function classifyError(
  error: unknown,
  actionKey?: keyof typeof CONTEXT_MESSAGES,
): ClassifiedError {
  const rawMessage = toMessage(error);
  const category = classifyCategory(error, rawMessage);
  const contextMessage = actionKey ? CONTEXT_MESSAGES[actionKey]?.[category] ?? CONTEXT_MESSAGES[actionKey]?.unknown : undefined;
  return {
    category,
    rawMessage,
    actionableMessage: contextMessage ?? fallbackActionableMessage(category),
  };
}

export function logErrorWithContext(error: unknown, context: ErrorContext): void {
  const baseError = error instanceof Error ? error : new Error(toMessage(error));
  captureError(baseError, {
    ...context,
    rawError: toMessage(error),
  });
  console.error("[app-error]", {
    ...context,
    name: baseError.name,
    message: baseError.message,
    stack: baseError.stack,
    rawError: toMessage(error),
  });
}
