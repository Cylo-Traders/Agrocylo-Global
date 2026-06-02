"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  getUserProfile,
  respondToReview,
  submitReview,
  updateUserProfile,
  voteReviewHelpful,
  type ProfileUpdateInput,
  type ReviewDraft,
  type UserProfileData,
} from "@/services/profileService";

export function useUserProfile(userId: string) {
  const queryClient = useQueryClient();

  const profileQuery = useQuery<UserProfileData>({
    queryKey: queryKeys.profile.byWallet(userId),
    queryFn: () => getUserProfile(userId),
    enabled: Boolean(userId),
  });

  const saveProfileMutation = useMutation({
    mutationFn: (input: ProfileUpdateInput) => updateUserProfile(userId, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.profile.byWallet(userId), updated);
    },
  });

  const submitReviewMutation = useMutation({
    mutationFn: (input: ReviewDraft) => submitReview(userId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.byWallet(userId),
      });
    },
  });

  const helpfulVoteMutation = useMutation({
    mutationFn: ({ reviewId, voterWallet }: { reviewId: string; voterWallet: string }) =>
      voteReviewHelpful(userId, reviewId, voterWallet),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.byWallet(userId),
      });
    },
  });

  const responseMutation = useMutation({
    mutationFn: ({
      reviewId,
      response,
      responderName,
    }: {
      reviewId: string;
      response: string;
      responderName: string;
    }) => respondToReview(userId, reviewId, response, responderName),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.byWallet(userId),
      });
    },
  });

  return {
    ...profileQuery,
    profileData: profileQuery.data ?? null,
    saveProfile: saveProfileMutation.mutateAsync,
    isSavingProfile: saveProfileMutation.isPending,
    submitReview: submitReviewMutation.mutateAsync,
    isSubmittingReview: submitReviewMutation.isPending,
    voteHelpful: helpfulVoteMutation.mutateAsync,
    isVotingHelpful: helpfulVoteMutation.isPending,
    respondToReview: responseMutation.mutateAsync,
    isRespondingToReview: responseMutation.isPending,
  };
}
