import type { IntentResponse, IntentResponseStatus, IntentResponseHistoryItem } from "@/types/intent";
import { createOrder } from "@/services/stellar/contractService";

const STORAGE_KEY = "agrocylo_buyer_intent_responses";

function getStoredResponses(): IntentResponse[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as IntentResponse[];
  } catch {
    return [];
  }
}

function saveStoredResponses(responses: IntentResponse[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(responses));
}

export async function getResponsesForIntent(intentId: string): Promise<IntentResponse[]> {
  return getStoredResponses().filter((r) => r.intentId === intentId);
}

export async function getResponseById(responseId: string): Promise<IntentResponse | null> {
  return getStoredResponses().find((r) => r.id === responseId) || null;
}

export async function saveProposal(
  intentId: string,
  sellerAddress: string,
  pricePerUnit: number,
  quantityAvailable: number,
  proposedDeliveryDate: string,
  message?: string,
  isDraft = false
): Promise<IntentResponse> {
  const responses = getStoredResponses();
  const now = new Date().toISOString();
  
  const newResponse: IntentResponse = {
    id: `resp_${Date.now()}`,
    intentId,
    sellerAddress,
    pricePerUnit,
    quantityAvailable,
    proposedDeliveryDate,
    message,
    status: isDraft ? "draft" : "pending",
    createdAt: now,
    updatedAt: now,
    history: [
      {
        status: isDraft ? "draft" : "pending",
        pricePerUnit,
        quantityAvailable,
        proposedDeliveryDate,
        message,
        timestamp: now,
      },
    ],
  };

  responses.push(newResponse);
  saveStoredResponses(responses);
  
  // Trigger toast notifications / simulated events
  if (!isDraft) {
    triggerMockNotification("intent_response", `Seller ${sellerAddress.slice(0, 6)}... proposed terms for your intent.`);
  }

  return newResponse;
}

export async function updateProposal(
  responseId: string,
  pricePerUnit: number,
  quantityAvailable: number,
  proposedDeliveryDate: string,
  message?: string,
  isDraft = false
): Promise<IntentResponse> {
  const responses = getStoredResponses();
  const idx = responses.findIndex((r) => r.id === responseId);
  if (idx === -1) throw new Error("Proposal not found.");

  const prev = responses[idx];
  const now = new Date().toISOString();

  const updatedHistory: IntentResponseHistoryItem[] = [
    ...(prev.history || []),
    {
      status: isDraft ? "draft" : "pending",
      pricePerUnit,
      quantityAvailable,
      proposedDeliveryDate,
      message,
      timestamp: now,
    },
  ];

  const updated: IntentResponse = {
    ...prev,
    pricePerUnit,
    quantityAvailable,
    proposedDeliveryDate,
    message,
    status: isDraft ? "draft" : "pending",
    updatedAt: now,
    history: updatedHistory,
  };

  responses[idx] = updated;
  saveStoredResponses(responses);

  if (!isDraft) {
    triggerMockNotification("intent_response", `Proposals updated for intent ${prev.intentId}`);
  }

  return updated;
}

export async function cancelProposal(responseId: string): Promise<IntentResponse> {
  const responses = getStoredResponses();
  const idx = responses.findIndex((r) => r.id === responseId);
  if (idx === -1) throw new Error("Proposal not found.");

  const prev = responses[idx];
  const now = new Date().toISOString();

  const updated: IntentResponse = {
    ...prev,
    status: "cancelled",
    updatedAt: now,
    history: [
      ...(prev.history || []),
      {
        status: "cancelled",
        pricePerUnit: prev.pricePerUnit,
        quantityAvailable: prev.quantityAvailable,
        proposedDeliveryDate: prev.proposedDeliveryDate,
        message: "Proposal cancelled by seller.",
        timestamp: now,
      },
    ],
  };

  responses[idx] = updated;
  saveStoredResponses(responses);
  return updated;
}

export async function acceptProposal(responseId: string, buyerAddress: string): Promise<IntentResponse> {
  const responses = getStoredResponses();
  const idx = responses.findIndex((r) => r.id === responseId);
  if (idx === -1) throw new Error("Proposal not found.");

  const prev = responses[idx];
  const now = new Date().toISOString();

  const updated: IntentResponse = {
    ...prev,
    status: "accepted",
    updatedAt: now,
    history: [
      ...(prev.history || []),
      {
        status: "accepted",
        pricePerUnit: prev.pricePerUnit,
        quantityAvailable: prev.quantityAvailable,
        proposedDeliveryDate: prev.proposedDeliveryDate,
        message: "Proposal accepted! Escrow order created.",
        timestamp: now,
      },
    ],
  };

  responses[idx] = updated;
  saveStoredResponses(responses);

  // Auto-create escrow order on acceptance!
  try {
    const totalStroops = BigInt(Math.floor(prev.pricePerUnit * prev.quantityAvailable * 10_000_000));
    // Call contract createOrder (simulates order block in testMode!)
    await createOrder(
      buyerAddress,
      prev.sellerAddress,
      "G-MOCK-NATIVE-TOKEN-XLM",
      totalStroops,
      prev.proposedDeliveryDate
    );
  } catch (err) {
    console.error("Failed to auto-create order on intent acceptance:", err);
  }

  triggerMockNotification("intent_acceptance", `Buyer accepted your proposed terms! On-chain escrow order initialized.`);
  return updated;
}

export async function rejectProposal(responseId: string): Promise<IntentResponse> {
  const responses = getStoredResponses();
  const idx = responses.findIndex((r) => r.id === responseId);
  if (idx === -1) throw new Error("Proposal not found.");

  const prev = responses[idx];
  const now = new Date().toISOString();

  const updated: IntentResponse = {
    ...prev,
    status: "rejected",
    updatedAt: now,
    history: [
      ...(prev.history || []),
      {
        status: "rejected",
        pricePerUnit: prev.pricePerUnit,
        quantityAvailable: prev.quantityAvailable,
        proposedDeliveryDate: prev.proposedDeliveryDate,
        message: "Proposal declined by buyer.",
        timestamp: now,
      },
    ],
  };

  responses[idx] = updated;
  saveStoredResponses(responses);
  return updated;
}

// Internal notification trigger helper
function triggerMockNotification(type: string, message: string) {
  if (typeof window === "undefined") return;
  import("sonner").then(({ toast }) => {
    toast.info("Notification System", {
      description: message,
      duration: 6000,
    });
  });
}
