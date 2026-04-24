"use client";

import React, { useRef, useState } from "react";
import { Button, Text } from "@/components/ui";

interface DisputeFormProps {
  isLoading: boolean;
  error: string | null;
  onSubmit: (reason: string, evidence: string) => Promise<void>;
  onCancel: () => void;
}

export default function DisputeForm({ isLoading, error, onSubmit, onCancel }: DisputeFormProps) {
  const [reason, setReason] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setEvidenceUrl(file.name);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    await onSubmit(reason.trim(), evidenceUrl.trim());
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
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
          disabled={isLoading}
        />
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            className="flex-1 rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
            placeholder="URL or file name"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            disabled={isLoading}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={isLoading}
          >
            Upload
          </Button>
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
