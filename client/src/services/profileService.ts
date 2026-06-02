import { API_BASE_URL as API_BASE } from "@/lib/apiConfig";
import { isTestMode } from "@/lib/testMode";
import type { ProfileRole } from "@/types/wallet";

export interface Profile {
  wallet_address: string;
  role: ProfileRole;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  city: string | null;
  country: string | null;
  is_public: boolean;
}

export interface ProfileUpdateInput {
  display_name?: string;
  bio?: string | null;
  avatar_url?: string | null;
}

function mapProfile(raw: Record<string, unknown>): Profile {
  const roleRaw = typeof raw.role === "string" ? raw.role : "buyer";
  const role = roleRaw.toLowerCase() as ProfileRole;

  return {
    wallet_address: String(raw.wallet_address ?? raw.walletAddress ?? ""),
    role: role === "admin" || role === "farmer" ? role : "buyer",
    display_name: String(raw.display_name ?? raw.name ?? ""),
    bio: raw.bio == null ? null : String(raw.bio),
    avatar_url: raw.avatar_url == null ? null : String(raw.avatar_url),
  };
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.detail ?? body?.message ?? body?.title ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function getProfile(wallet: string): Promise<Profile | null> {
  if (isTestMode()) {
    return {
      wallet_address: wallet,
      role: "farmer",
      display_name: "Test Farmer",
      bio: null,
      avatar_url: null,
    };
  }

  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(wallet)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const data = (await res.json()) as Record<string, unknown>;
  return mapProfile(data);
}

export async function createProfile(
  data: {
    role: ProfileRole;
    display_name: string;
    bio?: string;
    avatar_url?: string;
  },
  walletAddress: string,
): Promise<Profile> {
  if (isTestMode()) {
    return {
      wallet_address: walletAddress,
      role: data.role,
      display_name: data.display_name,
      bio: data.bio ?? null,
      avatar_url: data.avatar_url ?? null,
    };
  }

  const res = await fetch(`${API_BASE}/profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = (await res.json()) as Record<string, unknown>;
  return mapProfile(body);
}

export async function updateProfile(
  walletAddress: string,
  data: ProfileUpdateInput,
): Promise<Profile> {
  if (isTestMode()) {
    const existing = await getProfile(walletAddress);
    return {
      wallet_address: walletAddress,
      role: existing?.role ?? "farmer",
      display_name: data.display_name ?? existing?.display_name ?? "Test Farmer",
      bio: data.bio !== undefined ? data.bio : (existing?.bio ?? null),
      avatar_url:
        data.avatar_url !== undefined
          ? data.avatar_url
          : (existing?.avatar_url ?? null),
    };
  }

  const res = await fetch(
    `${API_BASE}/profiles/${encodeURIComponent(walletAddress)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-wallet-address": walletAddress,
      },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = (await res.json()) as Record<string, unknown>;
  return mapProfile(body);
}

export async function registerLocation(
  data: LocationData,
  walletAddress: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/locations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to register location: ${res.status}`);
}

const USER_PROFILE_PREFIX = "agrocylo:user-profile:";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function storageKey(userId: string): string {
  return `${USER_PROFILE_PREFIX}${userId}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 1_000_000_007;
  }
  return hash;
}

function pick<T>(items: T[], seed: number, offset = 0): T {
  return items[(seed + offset) % items.length];
}

function formatMonthLabel(offset: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - offset);
  return date.toLocaleString("en", { month: "short" });
}

function buildReputation(score: number): UserProfileReputation {
  const badge =
    score >= 95 ? "legend" : score >= 82 ? "top seller" : score >= 68 ? "trusted" : "new";

  const badgeDescription = {
    legend: "Elite performance across sales, reviews, and trust metrics.",
    "top seller": "Consistently strong ratings, response times, and delivery history.",
    trusted: "Reliable counterpart with positive transaction history.",
    new: "Profile is new and building a reputation.",
  }[badge];

  const history = Array.from({ length: 6 }, (_, index) => {
    const adjustment = Math.max(0, 5 - index) * 2;
    return {
      label: formatMonthLabel(5 - index),
      score: clamp(score - adjustment, 0, 100),
      note: index === 5 ? "Current reputation" : "Historical average",
    };
  });

  return { score, badge, badgeDescription, history };
}

function scoreFromStats(stats: UserProfileStats): number {
  const reviewScore = stats.averageRating * 11;
  const deliveryScore = stats.onTimeDeliveryRate * 0.25;
  const responseScore = stats.responseRate * 0.2;
  const disputePenalty = stats.disputeRate * 18;
  const transactionScore = Math.min(stats.transactionCount * 1.3, 18);

  return clamp(
    Math.round(35 + reviewScore + deliveryScore + responseScore + transactionScore - disputePenalty),
    0,
    100,
  );
}

function deriveStats(
  stats: UserProfileStats,
  reviews: UserReview[],
): UserProfileStats {
  const reviewCount = reviews.length;
  const averageRating =
    reviewCount > 0
      ? Number(
          (
            reviews.reduce((sum, review) => sum + review.rating, 0) / reviewCount
          ).toFixed(1),
        )
      : stats.averageRating;
  const helpfulVotesReceived = reviews.reduce((sum, review) => sum + review.helpfulVotes, 0);

  return {
    ...stats,
    reviewCount,
    averageRating,
    helpfulVotesReceived,
  };
}

function buildTrustIndicators(
  profile: UserProfileInfo,
  stats: UserProfileStats,
  reputation: UserProfileReputation,
): TrustIndicator[] {
  return [
    {
      label: "Transaction count",
      value: String(stats.transactionCount),
      description: "Completed marketplace transactions",
    },
    {
      label: "On-time delivery",
      value: `${stats.onTimeDeliveryRate}%`,
      description: "Fulfilled within agreed delivery window",
    },
    {
      label: "Response rate",
      value: `${stats.responseRate}%`,
      description: "Average speed in replying to buyers",
    },
    {
      label: "Average rating",
      value: stats.averageRating.toFixed(1),
      description: "Average score across verified reviews",
    },
    {
      label: "Member since",
      value: profile.memberSince,
      description: "Joined the AgroCylo marketplace",
    },
    {
      label: "Reputation badge",
      value: reputation.badge,
      description: reputation.badgeDescription,
    },
  ];
}

function buildReviews(seed: number, profile: UserProfileInfo): UserReview[] {
  const reviewNames = [
    "Amina S.",
    "Kwame T.",
    "Joyce M.",
    "Musa K.",
    "Zara H.",
  ];
  const titles = [
    "Smooth delivery and great communication",
    "Excellent quality produce",
    "Reliable and easy to work with",
    "Would buy again",
    "Fast response and honest seller",
  ];
  const bodies = [
    "The order was packed well, delivered on time, and the seller was proactive with updates.",
    "The produce arrived fresh and matched the listing exactly. Great experience overall.",
    "Communication was clear from start to finish, and the transaction closed without issues.",
    "Everything was straightforward and the quality exceeded expectations.",
    "They responded quickly to questions and kept every promise made during the transaction.",
  ];

  return Array.from({ length: 5 }, (_, index) => {
    const rating = clamp(5 - ((seed + index) % 3) * 0.5, 3.5, 5);
    return {
      id: `${profile.walletAddress}-review-${index + 1}`,
      reviewerName: reviewNames[(seed + index) % reviewNames.length],
      reviewerRole: index % 2 === 0 ? "buyer" : "farmer",
      reviewerWallet: `${profile.walletAddress.slice(0, 12)}${index + 1}`,
      rating,
      title: titles[(seed + index) % titles.length],
      body: bodies[(seed + index) % bodies.length],
      createdAt: new Date(Date.now() - (index + 1) * 86_400_000 * 12).toISOString(),
      transactionHash: `TX-${profile.walletAddress.slice(0, 6)}-${index + 1}`,
      verifiedTransaction: true,
      helpfulVotes: (seed + index) % 14,
      helpfulVoteWallets: [],
      evidence: index % 2 === 0 ? ["delivery-photo.jpg"] : [],
      response:
        index === 0
          ? {
              message: "Thanks for the thoughtful review. Looking forward to serving you again.",
              responderName: profile.displayName,
              respondedAt: new Date(Date.now() - 86_400_000 * 2).toISOString(),
            }
          : null,
    };
  });
}

function buildActivity(seed: number, profile: UserProfileInfo): ActivityEntry[] {
  const types: Array<ActivityEntry["kind"]> = ["sale", "purchase", "review", "dispute", "profile"];
  const actions = [
    "Completed an escrow settlement",
    "Received a verified review",
    "Updated fulfillment information",
    "Closed a dispute with admin support",
    "Refreshed profile and availability details",
  ];

  return Array.from({ length: 5 }, (_, index) => ({
    id: `${profile.walletAddress}-activity-${index + 1}`,
    kind: pick(types, seed, index),
    title: actions[(seed + index) % actions.length],
    description: index % 2 === 0
      ? `Activity recorded for ${profile.displayName}.`
      : `Trust history updated after a recent marketplace event.`,
    occurredAt: new Date(Date.now() - (index + 1) * 86_400_000 * 6).toISOString(),
  }));
}

function buildProfileInfo(userId: string, seed: number): UserProfileInfo {
  const role: "farmer" | "buyer" = seed % 2 === 0 ? "farmer" : "buyer";
  const displayNames = [
    "Green Valley Farms",
    "Harvest Bridge Co.",
    "Sunrise Produce",
    "Northfield Traders",
    "Urban Roots Market",
  ];
  const locations = [
    "Lagos, Nigeria",
    "Accra, Ghana",
    "Kampala, Uganda",
    "Nairobi, Kenya",
    "Abuja, Nigeria",
  ];

  return {
    walletAddress: userId,
    displayName: displayNames[seed % displayNames.length],
    bio:
      "Verified agricultural trader focused on transparent, fair, and timely marketplace transactions.",
    avatarUrl: null,
    location: locations[seed % locations.length],
    memberSince: new Date(2021 + (seed % 4), (seed % 10) + 1, 1).toLocaleDateString("en", {
      month: "short",
      year: "numeric",
    }),
    role,
    socialLinks: [
      {
        label: "Website",
        url: "https://agrocylo.example.com",
      },
      {
        label: "X",
        url: "https://x.com/",
      },
      {
        label: "Instagram",
        url: "https://instagram.com/",
      },
    ],
    verificationRequested: seed % 3 === 0,
    sellerBadge: role === "farmer" ? "Seller" : "Buyer",
    buyerBadge: role === "buyer" ? "Buyer" : "Farmer",
    privacy: {
      showLocation: true,
      showContactLinks: true,
    },
  };
}

function buildBaseProfile(userId: string): UserProfileData {
  const seed = hashString(userId);
  const profile = buildProfileInfo(userId, seed);

  const baseStats: UserProfileStats = {
    totalSales: 20 + (seed % 18),
    totalPurchases: 12 + (seed % 16),
    transactionCount: 32 + (seed % 28),
    responseRate: 88 + (seed % 10),
    responseTimeHours: 2 + (seed % 6),
    onTimeDeliveryRate: 92 + (seed % 7),
    averageRating: Number((4.3 + (seed % 5) * 0.1).toFixed(1)),
    disputeRate: Number(((seed % 4) * 0.5).toFixed(1)),
    reviewCount: 8 + (seed % 22),
    helpfulVotesReceived: 14 + (seed % 40),
  };

  const reviews = buildReviews(seed, profile);
  const activityTimeline = buildActivity(seed, profile);
  const stats = deriveStats(baseStats, reviews);
  const reputation = buildReputation(scoreFromStats(stats));

  const trustIndicators = buildTrustIndicators(profile, stats, reputation);

  return {
    walletAddress: userId,
    profile,
    stats,
    reputation,
    trustIndicators,
    activityTimeline,
    reviews,
  };
}

function readStoredProfile(userId: string): UserProfileData | null {
  if (!hasWindow()) return null;
  const raw = window.localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfileData;
  } catch {
    return null;
  }
}

function writeStoredProfile(profile: UserProfileData): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(storageKey(profile.walletAddress), JSON.stringify(profile));
}

function normalizeProfile(profile: UserProfileData): UserProfileData {
  const stats = deriveStats(profile.stats, profile.reviews);
  const reputation = buildReputation(scoreFromStats(stats));
  return {
    ...profile,
    stats,
    reputation,
    trustIndicators: buildTrustIndicators(profile.profile, stats, reputation),
  };
}

export async function getUserProfile(userId: string): Promise<UserProfileData> {
  const stored = readStoredProfile(userId);
  const base = buildBaseProfile(userId);
  return stored ? normalizeProfile({ ...base, ...stored, profile: { ...base.profile, ...stored.profile } }) : base;
}

export async function updateUserProfile(
  userId: string,
  input: ProfileUpdateInput,
): Promise<UserProfileData> {
  const current = await getUserProfile(userId);
  const next: UserProfileData = normalizeProfile({
    ...current,
    profile: {
      ...current.profile,
      displayName: input.displayName.trim() || current.profile.displayName,
      bio: input.bio.trim(),
      avatarUrl: input.avatarUrl,
      location: input.location.trim(),
      socialLinks: input.socialLinks.filter((link) => link.label.trim() && link.url.trim()),
      privacy: input.privacy,
      verificationRequested: input.verificationRequested,
    },
  });

  writeStoredProfile(next);
  return next;
}

export async function submitReview(
  userId: string,
  draft: ReviewDraft,
): Promise<UserReview> {
  if (draft.rating < 1 || draft.rating > 5) {
    throw new Error("Review rating must be between 1 and 5 stars.");
  }
  if (!draft.verifiedTransaction) {
    throw new Error("Reviews must be tied to a verified transaction.");
  }
  if (!draft.transactionHash.trim()) {
    throw new Error("Transaction hash is required to submit a review.");
  }
  if (draft.reviewerWallet === userId) {
    throw new Error("You cannot review your own profile.");
  }

  const current = await getUserProfile(userId);
  if (current.reviews.some((review) => review.transactionHash === draft.transactionHash.trim())) {
    throw new Error("This transaction has already been reviewed.");
  }

  const review: UserReview = {
    id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reviewerName: draft.reviewerName.trim(),
    reviewerRole: draft.reviewerRole,
    reviewerWallet: draft.reviewerWallet,
    rating: draft.rating,
    title: draft.title.trim(),
    body: draft.body.trim(),
    createdAt: new Date().toISOString(),
    transactionHash: draft.transactionHash.trim(),
    verifiedTransaction: draft.verifiedTransaction,
    helpfulVotes: 0,
    helpfulVoteWallets: [],
    evidence: draft.evidence,
    response: null,
  };

  const nextReviews = [review, ...current.reviews];
  const nextStats: UserProfileStats = {
    ...current.stats,
    reviewCount: nextReviews.length,
    averageRating:
      Number(
        (
          nextReviews.reduce((sum, item) => sum + item.rating, 0) / nextReviews.length
        ).toFixed(1),
      ),
    helpfulVotesReceived: nextReviews.reduce((sum, item) => sum + item.helpfulVotes, 0),
  };
  const next: UserProfileData = normalizeProfile({
    ...current,
    stats: nextStats,
    reviews: nextReviews,
    activityTimeline: [
      {
        id: `activity-${Date.now()}`,
        kind: "review",
        title: "New verified review added",
        description: `A ${draft.rating}-star review was added for this profile.`,
        occurredAt: new Date().toISOString(),
      },
      ...current.activityTimeline,
    ],
  });

  writeStoredProfile(next);
  return review;
}

export async function voteReviewHelpful(
  userId: string,
  reviewId: string,
  voterWallet: string,
): Promise<UserReview> {
  const current = await getUserProfile(userId);
  const review = current.reviews.find((item) => item.id === reviewId);
  if (!review) throw new Error("Review not found.");
  if (review.reviewerWallet === voterWallet) {
    throw new Error("You cannot mark your own review as helpful.");
  }
  if (review.helpfulVoteWallets.includes(voterWallet)) {
    return review;
  }

  const updatedReview: UserReview = {
    ...review,
    helpfulVotes: review.helpfulVotes + 1,
    helpfulVoteWallets: [...review.helpfulVoteWallets, voterWallet],
  };

  const nextReviews = current.reviews.map((item) =>
    item.id === reviewId ? updatedReview : item,
  );
  const next: UserProfileData = normalizeProfile({
    ...current,
    reviews: nextReviews,
    stats: {
      ...current.stats,
      helpfulVotesReceived: nextReviews.reduce((sum, item) => sum + item.helpfulVotes, 0),
    },
  });

  writeStoredProfile(next);
  return updatedReview;
}

export async function respondToReview(
  userId: string,
  reviewId: string,
  response: string,
  responderName: string,
): Promise<UserReview> {
  const current = await getUserProfile(userId);
  const review = current.reviews.find((item) => item.id === reviewId);
  if (!review) throw new Error("Review not found.");

  const updatedReview: UserReview = {
    ...review,
    response: {
      message: response.trim(),
      responderName,
      respondedAt: new Date().toISOString(),
    },
  };

  const next: UserProfileData = normalizeProfile({
    ...current,
    reviews: current.reviews.map((item) =>
      item.id === reviewId ? updatedReview : item,
    ),
  });

  writeStoredProfile(next);
  return updatedReview;
}
