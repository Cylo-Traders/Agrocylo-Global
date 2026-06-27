"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { createCampaign, type CreateCampaignRequest, type CampaignCreationPhase } from "@/services/campaignService";
import { parseXlmToStroops } from "@/lib/validation";

const STEPS = ["Details", "Deadline", "Image", "Review"];

export default function CreateCampaignPage() {
  const router = useRouter();
  const { address, connected, connect, loading: walletLoading } = useWallet();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CampaignCreationPhase>({ phase: "idle" });

  // Form state
  const [tokenAddress, setTokenAddress] = useState("");
  const [fundingGoal, setFundingGoal] = useState("");
  const [fundingGoalError, setFundingGoalError] = useState<string | null>(null);
  const [deadline, setDeadline] = useState("");
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFundingGoalChange(raw: string) {
    setFundingGoal(raw);
    if (!raw) {
      setFundingGoalError(null);
      return;
    }
    const result = parseXlmToStroops(raw);
    setFundingGoalError(result.valid ? null : result.error);
  }

  function handleDeadlineChange(raw: string) {
    setDeadline(raw);
    if (!raw) {
      setDeadlineError(null);
      return;
    }
    const d = new Date(raw);
    const now = new Date();
    if (d <= now) {
      setDeadlineError("Deadline must be in the future");
    } else {
      setDeadlineError(null);
    }
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setImageError("Only JPG, PNG, and WebP files are allowed");
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setImageError("Image must be less than 5MB");
      return;
    }

    setImageFile(file);
    setImageError(null);
  }

  const fundingGoalResult = parseXlmToStroops(fundingGoal);
  const isStep1Valid = tokenAddress && fundingGoalResult.valid && !fundingGoalError;
  const isStep2Valid = deadline && !deadlineError;
  const isStep3Valid = imageFile !== null;

  const handleConnect = useCallback(async () => {
    if (!connected) {
      await connect();
    }
  }, [connected, connect]);

  const handleSubmit = useCallback(async () => {
    if (!address || !isStep1Valid || !isStep2Valid || !isStep3Valid) return;

    setLoading(true);
    setError(null);

    try {
      const request: CreateCampaignRequest = {
        farmerAddress: address,
        tokenAddress,
        targetAmount: fundingGoalResult.stroops,
        deadline,
      };

      const result = await createCampaign(request, setPhase);

      if (!result.success) {
        setError(result.error ?? "Failed to create campaign");
        setPhase({ phase: "failed", error: result.error });
        return;
      }

      // Upload image after campaign is created
      setPhase({ phase: "registering" });
      if (imageFile && result.campaignId) {
        const formData = new FormData();
        formData.append("image", imageFile);

        const imageResponse = await fetch(`/api/campaigns/${result.campaignId}/image`, {
          method: "POST",
          body: formData,
        });

        if (!imageResponse.ok) {
          console.warn("Image upload failed, continuing with campaign creation");
        }
      }

      setPhase({ phase: "success" });
      setTimeout(() => {
        router.push("/campaigns");
      }, 2000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to create campaign";
      setError(errorMsg);
      setPhase({ phase: "failed", error: errorMsg });
    } finally {
      setLoading(false);
    }
  }, [address, isStep1Valid, isStep2Valid, isStep3Valid, tokenAddress, fundingGoalResult.stroops, deadline, imageFile, router]);

  if (!connected) {
    return (
      <div className="max-w-md mx-auto py-12">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Create a Campaign</h1>
          <p className="text-muted">Connect your wallet to create a new farming campaign</p>
          <button
            onClick={handleConnect}
            disabled={walletLoading}
            className="bg-primary-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {walletLoading ? "Connecting…" : "Connect Wallet"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link href="/campaigns" className="text-sm text-muted hover:text-foreground">
          ← Back to Campaigns
        </Link>
      </nav>

      <h1 className="text-3xl font-bold mb-8">Create Campaign</h1>

      {/* Step indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  i + 1 <= step
                    ? "bg-primary-600 text-white"
                    : "bg-border text-muted"
                }`}
              >
                {i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-1 mx-2 ${
                    i + 1 < step ? "bg-primary-600" : "bg-border"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted text-center">
          Step {step} of {STEPS.length}: {STEPS[step - 1]}
        </p>
      </div>

      {/* Step 1: Token & Funding Goal */}
      {step === 1 && (
        <div className="space-y-6 bg-surface border border-border rounded-xl p-6">
          <div>
            <label htmlFor="token-address" className="block text-sm font-medium mb-2">
              Token Contract Address <span className="text-error">*</span>
            </label>
            <input
              id="token-address"
              type="text"
              placeholder="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              className="w-full p-2 border border-border rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-muted mt-1">The Stellar token contract for this campaign</p>
          </div>

          <div>
            <label htmlFor="funding-goal" className="block text-sm font-medium mb-2">
              Funding Goal (XLM) <span className="text-error">*</span>
            </label>
            <input
              id="funding-goal"
              type="text"
              inputMode="decimal"
              placeholder="1000.00"
              value={fundingGoal}
              onChange={(e) => handleFundingGoalChange(e.target.value)}
              aria-invalid={!!fundingGoalError}
              aria-describedby={fundingGoalError ? "goal-error" : undefined}
              className={`w-full p-2 border rounded bg-background text-foreground focus:outline-none focus:ring-2 ${
                fundingGoalError
                  ? "border-error focus:ring-error"
                  : "border-border focus:ring-primary-500"
              }`}
            />
            {fundingGoalError && (
              <p id="goal-error" className="text-xs text-error mt-1" role="alert">
                {fundingGoalError}
              </p>
            )}
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!isStep1Valid}
            className="w-full bg-primary-600 text-white py-2 rounded font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Step 2: Deadline */}
      {step === 2 && (
        <div className="space-y-6 bg-surface border border-border rounded-xl p-6">
          <div>
            <label htmlFor="deadline" className="block text-sm font-medium mb-2">
              Funding Deadline <span className="text-error">*</span>
            </label>
            <input
              id="deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => handleDeadlineChange(e.target.value)}
              aria-invalid={!!deadlineError}
              aria-describedby={deadlineError ? "deadline-error" : undefined}
              className={`w-full p-2 border rounded bg-background text-foreground focus:outline-none focus:ring-2 ${
                deadlineError
                  ? "border-error focus:ring-error"
                  : "border-border focus:ring-primary-500"
              }`}
            />
            {deadlineError && (
              <p id="deadline-error" className="text-xs text-error mt-1" role="alert">
                {deadlineError}
              </p>
            )}
            <p className="text-xs text-muted mt-2">Deadline must be at least 1 minute in the future</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 border border-border text-foreground py-2 rounded font-medium hover:bg-surface"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!isStep2Valid}
              className="flex-1 bg-primary-600 text-white py-2 rounded font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Image Upload */}
      {step === 3 && (
        <div className="space-y-6 bg-surface border border-border rounded-xl p-6">
          <div>
            <label htmlFor="image-upload" className="block text-sm font-medium mb-2">
              Campaign Image <span className="text-error">*</span>
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded p-8 text-center cursor-pointer hover:bg-surface/50 transition-colors"
            >
              {imageFile ? (
                <div className="space-y-2">
                  <p className="font-medium text-foreground">{imageFile.name}</p>
                  <p className="text-xs text-muted">
                    {(imageFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Click to upload or drag and drop</p>
                  <p className="text-xs text-muted">PNG, JPG or WebP (max 5MB)</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              id="image-upload"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageSelect}
              className="hidden"
            />
            {imageError && (
              <p className="text-xs text-error mt-2" role="alert">
                {imageError}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 border border-border text-foreground py-2 rounded font-medium hover:bg-surface"
            >
              Back
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={!isStep3Valid}
              className="flex-1 bg-primary-600 text-white py-2 rounded font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Submit */}
      {step === 4 && (
        <div className="space-y-6 bg-surface border border-border rounded-xl p-6">
          <div className="space-y-4">
            <div className="pb-4 border-b border-border">
              <p className="text-xs text-muted mb-1">Token Address</p>
              <p className="font-mono text-sm break-all">{tokenAddress}</p>
            </div>
            <div className="pb-4 border-b border-border">
              <p className="text-xs text-muted mb-1">Funding Goal</p>
              <p className="text-lg font-semibold">{fundingGoal} XLM</p>
            </div>
            <div className="pb-4 border-b border-border">
              <p className="text-xs text-muted mb-1">Deadline</p>
              <p className="text-sm">{new Date(deadline).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted mb-1">Campaign Image</p>
              <p className="text-sm">{imageFile?.name}</p>
            </div>
          </div>

          {error && (
            <div className="border border-error bg-error/10 rounded p-4 text-error text-sm" role="alert">
              {error}
            </div>
          )}

          {phase.phase !== "idle" && (
            <div className="border border-primary-200 bg-primary-50 rounded p-4 text-sm">
              <p className="text-primary-900 capitalize font-medium">{phase.phase.replace("_", " ")}</p>
              {phase.txHash && (
                <p className="text-xs text-primary-700 mt-2 font-mono break-all">
                  TX: {phase.txHash}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              disabled={loading}
              className="flex-1 border border-border text-foreground py-2 rounded font-medium hover:bg-surface disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !isStep1Valid || !isStep2Valid || !isStep3Valid}
              className="flex-1 bg-success text-white py-2 rounded font-medium hover:bg-green-600 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Creating…
                </>
              ) : (
                "Create Campaign"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
