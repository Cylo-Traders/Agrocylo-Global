"use client";

import React, { useCallback, useRef, useState } from "react";
import { Button, Text } from "@/components/ui";

export interface EvidenceFile {
  name: string;
  size: number;
  previewUrl: string | null;
  hash: string;
}

interface EvidenceUploadProps {
  onChange: (file: EvidenceFile | null) => void;
  disabled?: boolean;
}

const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function EvidenceUpload({ onChange, disabled }: EvidenceUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [evidence, setEvidence] = useState<EvidenceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);

      if (file.size > MAX_BYTES) {
        setError("File exceeds 10 MB limit.");
        return;
      }

      setHashing(true);
      try {
        const hash = await sha256(file);
        const isImage = file.type.startsWith("image/");
        const previewUrl = isImage ? URL.createObjectURL(file) : null;

        const ev: EvidenceFile = { name: file.name, size: file.size, previewUrl, hash };
        setEvidence(ev);
        onChange(ev);
      } catch {
        setError("Failed to process file.");
      } finally {
        setHashing(false);
      }
    },
    [onChange]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  const handleRemove = () => {
    if (evidence?.previewUrl) URL.revokeObjectURL(evidence.previewUrl);
    setEvidence(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleChange}
        disabled={disabled || hashing}
      />

      {!evidence ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => !disabled && !hashing && inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 p-6 text-center cursor-pointer hover:border-gray-400 transition-colors"
        >
          <svg className="size-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <Text variant="body" muted className="text-sm">
            {hashing ? "Generating hash…" : "Drag & drop or click to upload"}
          </Text>
          <Text variant="body" muted className="text-xs">
            JPG, PNG, WEBP, GIF, PDF · max 10 MB
          </Text>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          {evidence.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={evidence.previewUrl}
              alt="evidence preview"
              className="max-h-48 w-full rounded object-contain bg-gray-50"
            />
          )}

          <div className="text-xs space-y-0.5">
            <p className="font-medium truncate">{evidence.name}</p>
            <p className="text-gray-500">{(evidence.size / 1024).toFixed(1)} KB</p>
            <p className="text-gray-400 break-all font-mono">SHA-256: {evidence.hash}</p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
          >
            Remove
          </Button>
        </div>
      )}

      {error && (
        <Text variant="body" className="text-error text-xs">{error}</Text>
      )}
    </div>
  );
}
