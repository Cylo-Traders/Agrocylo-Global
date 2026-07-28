import { API_BASE_URL } from "@/lib/apiConfig";

export interface GovernanceProposal {
  proposalId: string;
  proposer: string | null;
  targetContract: string | null;
  functionName: string | null;
  status: "VOTING" | "QUEUED" | "EXECUTED" | "REJECTED";
  votesFor: string;
  votesAgainst: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!response.ok) throw new Error(`Governance request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function getGovernanceProposals(): Promise<GovernanceProposal[]> {
  return request("/governance/proposals");
}

export function voteOnProposal(proposalId: string, support: boolean): Promise<void> {
  return request(`/governance/proposals/${proposalId}/votes`, {
    method: "POST",
    body: JSON.stringify({ support }),
  });
}

export function createGovernanceProposal(input: {
  changeType: "fee_rate" | "token_whitelist";
  value: string;
}): Promise<void> {
  return request("/governance/proposals", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
