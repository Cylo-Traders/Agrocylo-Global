import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import UserProfile from "./UserProfile";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GTESTPROFILE0000000000000000000000000000000000000000000",
    connected: true,
  }),
}));

vi.mock("@/hooks/useUserProfile", () => ({
  useUserProfile: () => ({
    profileData: {
      walletAddress: "GTESTPROFILE0000000000000000000000000000000000000000000",
      profile: {
        walletAddress: "GTESTPROFILE0000000000000000000000000000000000000000000",
        displayName: "Green Valley Farms",
        bio: "Fresh produce and verified deliveries.",
        avatarUrl: null,
        location: "Lagos, Nigeria",
        memberSince: "Jan 2023",
        role: "farmer",
        socialLinks: [],
        verificationRequested: true,
        sellerBadge: "Seller",
        buyerBadge: "Buyer",
        privacy: {
          showLocation: true,
          showContactLinks: true,
        },
      },
      stats: {
        totalSales: 26,
        totalPurchases: 7,
        transactionCount: 33,
        responseRate: 96,
        responseTimeHours: 2,
        onTimeDeliveryRate: 98,
        averageRating: 4.8,
        disputeRate: 0,
        reviewCount: 5,
        helpfulVotesReceived: 18,
      },
      reputation: {
        score: 94,
        badge: "top seller",
        badgeDescription: "Consistently strong ratings, response times, and delivery history.",
        history: [
          { label: "Jan", score: 88, note: "Historical average" },
          { label: "Feb", score: 90, note: "Historical average" },
          { label: "Mar", score: 92, note: "Historical average" },
          { label: "Apr", score: 93, note: "Historical average" },
          { label: "May", score: 94, note: "Historical average" },
          { label: "Jun", score: 94, note: "Current reputation" },
        ],
      },
      trustIndicators: [
        { label: "Transaction count", value: "33", description: "Completed marketplace transactions" },
        { label: "On-time delivery", value: "98%", description: "Fulfilled within agreed delivery window" },
      ],
      activityTimeline: [
        {
          id: "act-1",
          kind: "sale",
          title: "Completed an escrow settlement",
          description: "Activity recorded for Green Valley Farms.",
          occurredAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      reviews: [
        {
          id: "review-1",
          reviewerName: "Amina S.",
          reviewerRole: "buyer",
          reviewerWallet: "GAMINA",
          rating: 5,
          title: "Great delivery",
          body: "Everything arrived on time and matched the listing.",
          createdAt: "2026-04-01T00:00:00.000Z",
          transactionHash: "TX-1",
          verifiedTransaction: true,
          helpfulVotes: 3,
          helpfulVoteWallets: [],
          evidence: ["receipt.jpg"],
          response: {
            message: "Thanks for the review.",
            responderName: "Green Valley Farms",
            respondedAt: "2026-04-02T00:00:00.000Z",
          },
        },
      ],
    },
    isLoading: false,
    error: null,
    submitReview: vi.fn(),
    isSubmittingReview: false,
    voteHelpful: vi.fn(),
    respondToReview: vi.fn(),
  }),
}));

describe("UserProfile", () => {
  it("renders the profile, reputation, and review history", () => {
    render(<UserProfile userId="GTESTPROFILE0000000000000000000000000000000000000000000" />);

    expect(screen.getByText("Green Valley Farms")).toBeInTheDocument();
    expect(screen.getAllByText("94").length).toBeGreaterThan(0);
    expect(screen.getByText("Review history")).toBeInTheDocument();
    expect(screen.getByText("Great delivery")).toBeInTheDocument();
    expect(screen.getByText("Helpful (3)")).toBeInTheDocument();
    expect(screen.getByText("Profile summary")).toBeInTheDocument();
  });
});
