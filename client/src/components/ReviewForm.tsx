"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Camera, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReviewDraft } from "@/services/profileService";

interface ReviewFormProps {
  reviewerName: string;
  reviewerRole: "farmer" | "buyer";
  reviewerWallet: string;
  onSubmit: (draft: ReviewDraft) => Promise<void> | void;
  isSubmitting?: boolean;
  className?: string;
}

const STAR_LABELS = ["Poor", "Fair", "Good", "Great", "Excellent"];

export default function ReviewForm({
  reviewerName,
  reviewerRole,
  reviewerWallet,
  onSubmit,
  isSubmitting = false,
  className,
}: ReviewFormProps) {
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [verifiedTransaction, setVerifiedTransaction] = useState(true);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(
    () => () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    },
    [previewUrls],
  );

  const canSubmit = useMemo(
    () =>
      title.trim().length >= 3 &&
      body.trim().length >= 20 &&
      transactionHash.trim().length > 5 &&
      rating >= 1 &&
      rating <= 5 &&
      verifiedTransaction,
    [body, rating, title, transactionHash, verifiedTransaction],
  );

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const nextAttachments = Array.from(files).map((file) => file.name);
    const nextPreviewUrls = Array.from(files).map((file) => URL.createObjectURL(file));
    setAttachments((current) => [...current, ...nextAttachments]);
    setPreviewUrls((current) => [...current, ...nextPreviewUrls]);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!canSubmit) {
      setError(
        "Add a title, a detailed review, a verified transaction hash, and keep the star rating between 1 and 5.",
      );
      return;
    }

    try {
      await onSubmit({
        reviewerName,
        reviewerRole,
        reviewerWallet,
        rating,
        title: title.trim(),
        body: body.trim(),
        transactionHash: transactionHash.trim(),
        verifiedTransaction,
        evidence: attachments,
      });

      setTitle("");
      setBody("");
      setTransactionHash("");
      setAttachments([]);
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      setPreviewUrls([]);
      setRating(5);
      setVerifiedTransaction(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to submit review.",
      );
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className={cn("rounded-3xl border bg-card p-5 sm:p-6", className)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Leave a review</h3>
          <p className="text-muted-foreground text-sm">
            Reviews are only accepted after verified transactions.
          </p>
        </div>
        <Badge variant="success" className="w-fit gap-1">
          <ShieldCheck className="size-3.5" />
          Authenticity checked
        </Badge>
      </div>

      <div className="mt-5 space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium">
            Rating: <span className="text-primary">{STAR_LABELS[rating - 1]}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }, (_, index) => {
              const value = index + 1;
              const active = value <= rating;
              return (
                <button
                  type="button"
                  key={value}
                  onClick={() => setRating(value)}
                  aria-label={`${value} star${value > 1 ? "s" : ""}`}
                  className={cn(
                    "grid size-11 place-content-center rounded-full border transition",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-primary",
                  )}
                >
                  <Star className={cn("size-4", active && "fill-current")} />
                </button>
              );
            })}
          </div>
        </div>

        <Input
          label="Review title"
          placeholder="Short summary of your experience"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <div className="grid gap-1.5">
          <Label htmlFor="written-review">Written review</Label>
          <Textarea
            id="written-review"
            placeholder="Share what went well, what could improve, and whether the transaction matched expectations."
            rows={5}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>

        <Input
          label="Transaction hash"
          placeholder="Verified transaction or order hash"
          value={transactionHash}
          onChange={(event) => setTransactionHash(event.target.value)}
          hint="Used to prevent duplicate or fake reviews."
        />

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-dashed p-4">
          <Camera className="mt-0.5 size-5 text-primary" />
          <div className="flex-1">
            <p className="font-medium">Photo / evidence upload</p>
            <p className="text-muted-foreground text-sm">
              Add receipts, delivery photos, or evidence files for support.
            </p>
            <input
              type="file"
              multiple
              accept="image/*"
              className="mt-3 block w-full text-sm"
              onChange={(event) => handleFiles(event.target.files)}
            />
          </div>
        </label>

        {previewUrls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((name, index) => (
              <span
                key={`${name}-${index}`}
                className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
              >
                {name}
              </span>
            ))}
          </div>
        )}

        <label className="flex items-start gap-3 rounded-2xl border bg-secondary/30 p-4 text-sm">
          <input
            type="checkbox"
            checked={verifiedTransaction}
            onChange={(event) => setVerifiedTransaction(event.target.checked)}
            className="mt-1 size-4"
          />
          <span>
            I confirm this review is based on a real completed transaction and not a fabricated rating.
          </span>
        </label>

        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
          {isSubmitting ? "Submitting..." : "Submit review"}
        </Button>
      </div>
    </form>
  );
}
