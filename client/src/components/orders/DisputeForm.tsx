"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import EvidenceUpload, { type EvidenceFile } from "./EvidenceUpload";
import { disputeFormSchema } from "@/lib/validation";

interface DisputeFormProps {
  isLoading: boolean;
  error: string | null;
  onSubmit: (reason: string, evidence: string) => Promise<void>;
  onCancel: () => void;
}

export default function DisputeForm({
  isLoading,
  error,
  onSubmit,
  onCancel,
}: DisputeFormProps) {
  const [reason, setReason] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<EvidenceFile | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const result = disputeFormSchema.safeParse({ reason: reason.trim() });
    if (!result.success) {
      setReasonError(result.error.issues[0]?.message ?? "Reason is required");
      return;
    }

    setReasonError(null);
    await onSubmit(reason.trim(), evidenceFile?.hash ?? "");
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="space-y-4"
      aria-label="Open dispute"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="dispute-reason">Reason</Label>
        <Textarea
          id="dispute-reason"
          rows={3}
          placeholder="Describe the issue — what's wrong with the delivery?"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (reasonError) setReasonError(null);
          }}
          required
          disabled={isLoading}
        />
        {reasonError && (
          <p className="text-destructive text-xs" role="alert">
            {reasonError}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label>Evidence (optional)</Label>
        <p className="text-muted-foreground text-xs">
          A SHA-256 hash of your file is recorded on-chain; the file itself is
          uploaded to the dispute backend for the admin to review.
        </p>
        <EvidenceUpload onChange={setEvidenceFile} disabled={isLoading} />
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border p-3 text-xs">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="destructive"
          isLoading={isLoading}
          disabled={!reason.trim() || isLoading}
          className="flex-[2]"
        >
          <ShieldAlert className="size-4" />
          Submit Dispute
        </Button>
      </div>
    </form>
  );
}
