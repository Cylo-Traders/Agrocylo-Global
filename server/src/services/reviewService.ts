import { prisma } from "../config/database.js";

export interface ReviewResponseDto {
  message: string;
  responderName: string;
  respondedAt: Date;
}

export interface ReviewDto {
  id: string;
  subjectWallet: string;
  reviewerWallet: string;
  reviewerName: string;
  reviewerRole: string;
  rating: number;
  title: string;
  body: string;
  transactionHash: string;
  verifiedTransaction: boolean;
  helpfulVotes: number;
  helpfulVoteWallets: string[];
  evidence: string[];
  response: ReviewResponseDto | null;
  createdAt: Date;
  updatedAt: Date;
}

function toReviewDto(review: {
  id: string;
  subjectWallet: string;
  reviewerWallet: string;
  reviewerName: string;
  reviewerRole: string;
  rating: number;
  title: string;
  body: string;
  transactionHash: string;
  verifiedTransaction: boolean;
  helpfulVotes: number;
  helpfulVoteWallets: string[];
  evidence: string[];
  responseMessage: string | null;
  responderName: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ReviewDto {
  return {
    id: review.id,
    subjectWallet: review.subjectWallet,
    reviewerWallet: review.reviewerWallet,
    reviewerName: review.reviewerName,
    reviewerRole: review.reviewerRole,
    rating: review.rating,
    title: review.title,
    body: review.body,
    transactionHash: review.transactionHash,
    verifiedTransaction: review.verifiedTransaction,
    helpfulVotes: review.helpfulVotes,
    helpfulVoteWallets: review.helpfulVoteWallets ?? [],
    evidence: review.evidence ?? [],
    response:
      review.responseMessage && review.responderName && review.respondedAt
        ? {
            message: review.responseMessage,
            responderName: review.responderName,
            respondedAt: review.respondedAt,
          }
        : null,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

export async function listReviewsForSubject(
  subjectWallet: string,
  limit = 20,
): Promise<ReviewDto[]> {
  const reviews = await prisma.review.findMany({
    where: { subjectWallet },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Math.trunc(limit), 1), 100),
  });

  return reviews.map(toReviewDto);
}

export async function getReviewSummary(subjectWallet: string): Promise<{
  reviewCount: number;
  averageRating: number | null;
  verifiedReviewCount: number;
}> {
  const [aggregate, verifiedReviewCount] = await Promise.all([
    prisma.review.aggregate({
      where: { subjectWallet },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    prisma.review.count({
      where: { subjectWallet, verifiedTransaction: true },
    }),
  ]);

  return {
    reviewCount: aggregate._count._all,
    averageRating: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(2)) : null,
    verifiedReviewCount,
  };
}

export async function createReview(
  subjectWallet: string,
  body: unknown,
): Promise<ReviewDto> {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const requiredFields = [
    "reviewerWallet",
    "reviewerName",
    "reviewerRole",
    "rating",
    "title",
    "body",
    "transactionHash",
  ] as const;
  for (const field of requiredFields) {
    if (record[field] === undefined || record[field] === null || record[field] === "") {
      throw new Error(`${field} is required`);
    }
  }

  const rating = Number(record.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error("rating must be between 1 and 5");
  }

  const review = await prisma.review.create({
    data: {
      subjectWallet,
      reviewerWallet: String(record.reviewerWallet),
      reviewerName: String(record.reviewerName),
      reviewerRole: String(record.reviewerRole),
      rating: Math.trunc(rating),
      title: String(record.title),
      body: String(record.body),
      transactionHash: String(record.transactionHash),
      verifiedTransaction:
        typeof record.verifiedTransaction === "boolean" ? record.verifiedTransaction : true,
      helpfulVoteWallets: Array.isArray(record.helpfulVoteWallets)
        ? record.helpfulVoteWallets.filter((item) => typeof item === "string")
        : [],
      evidence: Array.isArray(record.evidence)
        ? record.evidence.filter((item) => typeof item === "string")
        : [],
    },
  });

  return toReviewDto(review);
}

