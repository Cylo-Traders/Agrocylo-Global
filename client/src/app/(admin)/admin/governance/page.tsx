"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import {
  createGovernanceProposal,
  getGovernanceProposals,
  voteOnProposal,
  type GovernanceProposal,
} from "@/services/governanceService";

export default function GovernancePage() {
  const [proposals, setProposals] = useState<GovernanceProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changeType, setChangeType] = useState<"fee_rate" | "token_whitelist">("fee_rate");
  const [value, setValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProposals(await getGovernanceProposals());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load proposals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await createGovernanceProposal({ changeType, value });
    setValue("");
    await load();
  }

  async function vote(proposalId: string, support: boolean) {
    await voteOnProposal(proposalId, support);
    await load();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Governance"
        description="Create parameter proposals and vote on indexed on-chain governance."
      />

      <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-6">
        <h2 className="font-semibold">Create proposal</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="change-type">Parameter</Label>
            <select
              id="change-type"
              className="h-10 w-full rounded-md border bg-background px-3"
              value={changeType}
              onChange={(event) =>
                setChangeType(event.target.value as "fee_rate" | "token_whitelist")
              }
            >
              <option value="fee_rate">Fee rate (basis points)</option>
              <option value="token_whitelist">Token whitelist</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-value">New value</Label>
            <Input
              id="proposal-value"
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={changeType === "fee_rate" ? "300" : "Contract address"}
            />
          </div>
        </div>
        <Button type="submit">Submit proposal</Button>
      </form>

      {loading && <p className="text-muted-foreground">Loading proposals…</p>}
      {error && (
        <div className="rounded-lg border border-destructive p-4">
          <p className="text-destructive">{error}</p>
          <Button className="mt-3" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && proposals.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No governance proposals have been indexed yet.
        </div>
      )}
      <div className="space-y-4">
        {proposals.map((proposal) => (
          <article key={proposal.proposalId} className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Proposal #{proposal.proposalId}</h2>
                <p className="text-sm text-muted-foreground">
                  {proposal.functionName ?? "Contract parameter change"} · {proposal.status}
                </p>
              </div>
              {proposal.status === "VOTING" && (
                <div className="flex gap-2">
                  <Button onClick={() => void vote(proposal.proposalId, true)}>Vote for</Button>
                  <Button
                    variant="outline"
                    onClick={() => void vote(proposal.proposalId, false)}
                  >
                    Vote against
                  </Button>
                </div>
              )}
            </div>
            <p className="mt-4 text-sm">
              For: {proposal.votesFor} · Against: {proposal.votesAgainst}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
