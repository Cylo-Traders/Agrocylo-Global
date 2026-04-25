"use client";

import React, { useState } from "react";
import { Button, Text } from "@/components/ui";
import EvidenceUpload, { type EvidenceFile } from "./EvidenceUpload";

interface DisputeFormProps {
  isLoading: boolean;
  error: string | null;
  onSubmit: (reason: string, evidence: string) => Promise<void>;
  onCancel: () => void;
}

export default function DisputeForm({ isLoading, error, onSubmit, onCancel }: DisputeFormProps) {
  const [reason, setReason] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<EvidenceFile | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    // Pass the hash as the evidence identifier; fall back to empty string
    await onSubmit(reason.trim(), evidenceFile?.hash ?? "");
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 pt-2">
      <div>
        <Text variant="body" muted>Reason</Text>
        <textarea
          className="mt-1 w-full rounded border border-gray-300 p-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-red-400"
          rows={3}
          placeholder="Describe the issue..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          disabled={isLoading}
        />
      </div>

      <div>
        <Text variant="body" muted>Evidence (optional)</Text>
        <div className="mt-1">
          <EvidenceUpload onChange={setEvidenceFile} disabled={isLoading} />
        </div>
      </div>

      {error && (
        <Text variant="body" className="text-error text-xs">{error}</Text>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          variant="danger"
          size="sm"
          isLoading={isLoading}
          disabled={!reason.trim() || isLoading}
          className="flex-1"
        >
          Submit Dispute
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
