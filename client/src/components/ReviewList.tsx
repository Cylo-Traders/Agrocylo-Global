"use client";

import { useState } from "react";
import { CheckCheck, MessageSquareReply, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StarRating } from "@/components/shared/star-rating";
import { cn } from "@/lib/utils";
import type { UserReview } from "@/services/profileService";

interface ReviewListProps {
  reviews: UserReview[];
  isOwner?: boolean;
  currentUserName?: string;
  onHelpfulVote?: (reviewId: string) => Promise<void> | void;
  onRespond?: (reviewId: string, response: string) => Promise<void> | void;
  className?: string;
}

export default function ReviewList({
  reviews,
  isOwner = false,
  currentUserName = "Seller",
  onHelpfulVote,
  onRespond,
  className,
}: ReviewListProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [activeHelpful, setActiveHelpful] = useState<string | null>(null);

  async function handleHelpful(reviewId: string) {
    if (!onHelpfulVote) return;
    setActiveHelpful(reviewId);
    try {
      await onHelpfulVote(reviewId);
    } finally {
      setActiveHelpful(null);
    }
  }

  async function handleResponseSubmit(reviewId: string) {
    if (!onRespond || !response.trim()) return;
    await onRespond(reviewId, response.trim());
    setResponse("");
    setReplyingTo(null);
  }

  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Review history</h3>
          <p className="text-muted-foreground text-sm">
            Verified reviews, helpful votes, and public responses.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <CheckCheck className="size-3.5" />
          {reviews.length} review{reviews.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="space-y-4">
        {reviews.map((review) => (
          <article key={review.id} className="rounded-3xl border bg-card p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold">{review.title}</h4>
                  <Badge variant="outline" className="gap-1">
                    {review.reviewerRole}
                  </Badge>
                  {review.verifiedTransaction && (
                    <Badge variant="success" className="gap-1">
                      <CheckCheck className="size-3.5" />
                      Verified
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StarRating rating={review.rating} />
                  <span className="text-muted-foreground text-xs">
                    by {review.reviewerName} on{" "}
                    {new Date(review.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => void handleHelpful(review.id)}
                disabled={!onHelpfulVote || activeHelpful === review.id}
              >
                <ThumbsUp className="size-4" />
                Helpful {review.helpfulVotes > 0 ? `(${review.helpfulVotes})` : ""}
              </Button>
            </div>

            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              {review.body}
            </p>

            {review.evidence.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {review.evidence.map((item) => (
                  <span
                    key={item}
                    className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}

            {review.response && (
              <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
                  <MessageSquareReply className="size-3.5" />
                  Response from {review.response.responderName}
                </div>
                <p className="text-sm leading-relaxed">{review.response.message}</p>
                <p className="text-muted-foreground mt-2 text-xs">
                  {new Date(review.response.respondedAt).toLocaleDateString()}
                </p>
              </div>
            )}

            {isOwner && !review.response && onRespond && (
              <div className="mt-4 space-y-3 rounded-2xl border bg-secondary/20 p-4">
                {replyingTo === review.id ? (
                  <>
                    <Textarea
                      placeholder="Write a public response..."
                      rows={3}
                      value={response}
                      onChange={(event) => setResponse(event.target.value)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleResponseSubmit(review.id)}
                      >
                        Publish response
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setReplyingTo(null);
                          setResponse("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    onClick={() => {
                      setReplyingTo(review.id);
                    }}
                  >
                    <MessageSquareReply className="size-4" />
                    Reply as {currentUserName}
                  </Button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
