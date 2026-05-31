"use client";

import { useState, useEffect } from "react";
import {
  X,
  History,
  Send,
  FileText,
  Calendar,
  AlertCircle,
  CheckCircle,
  HelpCircle,
  Plus,
  Minus,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import type { BuyerIntent } from "@/types/demand";
import type { IntentResponse } from "@/types/intent";
import { useWallet } from "@/hooks/useWallet";
import {
  getResponsesForIntent,
  saveProposal,
  updateProposal,
  cancelProposal,
  acceptProposal,
  rejectProposal,
} from "@/services/intentResponseService";
import { cn } from "@/lib/utils";

interface BuyerIntentResponseProps {
  intent: BuyerIntent;
  isOpen: boolean;
  onClose: () => void;
}

export default function BuyerIntentResponse({
  intent,
  isOpen,
  onClose,
}: BuyerIntentResponseProps) {
  const { address: sellerAddress, connected } = useWallet();

  const [pricePerUnit, setPricePerUnit] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  
  const [responses, setResponses] = useState<IntentResponse[]>([]);
  const [activeTab, setActiveTab] = useState<"propose" | "history">("propose");
  const [editingResponse, setEditingResponse] = useState<IntentResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadResponses();
      // Initialize inputs based on intent defaults
      setQuantity(intent.quantity);
      setPricePerUnit("");
      setDeliveryDate("");
      setMessage("");
      setActiveTab("propose");
      setEditingResponse(null);
    }
  }, [isOpen, intent]);

  async function loadResponses() {
    try {
      const data = await getResponsesForIntent(intent.id);
      setResponses(data);
      
      // If there is an active draft, let's load it immediately for editing
      const draft = data.find((r) => r.status === "draft");
      if (draft) {
        setEditingResponse(draft);
        setPricePerUnit(String(draft.pricePerUnit));
        setQuantity(String(draft.quantityAvailable));
        setDeliveryDate(draft.proposedDeliveryDate);
        setMessage(draft.message || "");
        toast.info("Active draft loaded.");
      }
    } catch (err) {
      console.error("Failed to load responses:", err);
    }
  }

  const validate = (): string | null => {
    if (!connected || !sellerAddress) return "Please connect your wallet first.";
    const price = parseFloat(pricePerUnit);
    const qty = parseFloat(quantity);
    if (isNaN(price) || price <= 0) return "Please enter a valid positive price.";
    if (isNaN(qty) || qty <= 0) return "Please enter a valid positive quantity.";
    if (!deliveryDate) return "Proposed delivery date is required.";
    if (new Date(deliveryDate) <= new Date()) return "Proposed delivery date must be in the future.";
    return null;
  };

  async function handleSave(isDraft: boolean) {
    const errorMsg = validate();
    if (errorMsg) {
      toast.error(errorMsg);
      return;
    }

    setIsSubmitting(true);
    try {
      const price = parseFloat(pricePerUnit);
      const qty = parseFloat(quantity);

      if (editingResponse) {
        // Update existing draft
        await updateProposal(
          editingResponse.id,
          price,
          qty,
          deliveryDate,
          message,
          isDraft
        );
        toast.success(isDraft ? "Draft updated successfully!" : "Proposal sent to buyer!");
      } else {
        // Create new proposal
        await saveProposal(
          intent.id,
          sellerAddress!,
          price,
          qty,
          deliveryDate,
          message,
          isDraft
        );
        toast.success(isDraft ? "Draft saved successfully!" : "Proposal sent to buyer!");
      }

      await loadResponses();
      if (!isDraft) {
        onClose();
      }
    } catch (err) {
      toast.error("Failed to submit proposal terms.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel(responseId: string) {
    try {
      await cancelProposal(responseId);
      toast.success("Proposal cancelled successfully.");
      await loadResponses();
    } catch (err) {
      toast.error("Failed to cancel proposal.");
    }
  }

  // Simulated buyer acceptance flow for demonstration
  async function handleSimulateBuyerAccept(responseId: string) {
    if (!connected || !sellerAddress) {
      toast.error("Connect your wallet first.");
      return;
    }
    try {
      await acceptProposal(responseId, sellerAddress);
      toast.success("Buyer accepted terms! Escrow created successfully.");
      await loadResponses();
    } catch (err) {
      toast.error("Failed to accept proposal.");
    }
  }

  if (!isOpen) return null;

  const activeProposal = responses.find((r) => r.status === "pending");

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200 dark:border-zinc-800">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-primary/5 to-transparent p-5 border-b dark:border-zinc-800 flex items-start justify-between">
          <div>
            <Badge variant="outline" className="mb-1 text-xs border-primary/20 text-primary">
              Propose Terms
            </Badge>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
              Respond to {intent.buyer_name}'s Intent
            </h2>
            <p className="text-muted-foreground text-xs mt-1 leading-normal">
              Propose unit pricing, delivery schedules, and quantity adjustments for <strong>{intent.product_name}</strong>.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-850 p-1.5 rounded-lg transition-all"
            aria-label="Close modal"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 px-4">
          <button
            onClick={() => setActiveTab("propose")}
            className={cn(
              "px-4 py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5",
              activeTab === "propose"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="size-3.5" />
            Terms Proposal
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={cn(
              "px-4 py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5",
              activeTab === "history"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <History className="size-3.5" />
            Proposal History ({responses.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Tab 1: Propose */}
          {activeTab === "propose" && (
            <div className="space-y-5">
              
              {/* Buyer Context Panel */}
              <div className="bg-zinc-50/50 dark:bg-zinc-900/30 border border-zinc-150 dark:border-zinc-800 rounded-xl p-4 grid gap-3 sm:grid-cols-3 text-xs leading-normal">
                <div>
                  <span className="text-muted-foreground font-medium">Desired Volume</span>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                    {intent.quantity} {intent.unit}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">Budget Target</span>
                  <div className="font-semibold text-green-600 dark:text-green-400 mt-0.5">
                    {intent.budget_range || "Flexible"}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground font-medium">Preferred Delivery</span>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5 truncate">
                    {intent.delivery_preference || "Standard Delivery"}
                  </div>
                </div>
              </div>

              {activeProposal ? (
                <div className="bg-emerald-50/30 border border-emerald-100 dark:bg-emerald-950/10 dark:border-emerald-900/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 text-sm font-semibold">
                    <CheckCircle className="size-4 shrink-0" />
                    Active Proposal Submitted
                  </div>
                  <p className="text-xs text-muted-foreground leading-normal">
                    You have an active proposal submitted for this intent. You can cancel it or wait for the buyer to accept or counter.
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                    <div>
                      <span className="text-muted-foreground">Price Proposed</span>
                      <div className="font-semibold">{activeProposal.pricePerUnit} XLM</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Qty Offered</span>
                      <div className="font-semibold">{activeProposal.quantityAvailable} {intent.unit}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Delivery Date</span>
                      <div className="font-semibold">{new Date(activeProposal.proposedDeliveryDate).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCancel(activeProposal.id)}
                      className="text-xs rounded-lg border-rose-250 text-rose-600 hover:bg-rose-50"
                    >
                      Cancel Proposal
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleSimulateBuyerAccept(activeProposal.id)}
                      className="text-xs rounded-lg flex items-center gap-1"
                    >
                      Simulate Buyer Accept <ArrowRight className="size-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Inputs Grid */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    
                    {/* Unit Price */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-700 dark:text-zinc-350">
                        Proposed Price per Unit (XLM)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={pricePerUnit}
                        onChange={(e) => setPricePerUnit(e.target.value)}
                        className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        placeholder="e.g. 10.50"
                      />
                    </div>

                    {/* Quantity Available */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-700 dark:text-zinc-350">
                        Propose Quantity ({intent.unit})
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        placeholder="e.g. 100"
                      />
                    </div>

                    {/* Proposed Delivery Date */}
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-xs font-bold text-zinc-700 dark:text-zinc-350">
                        Proposed Delivery Date
                      </label>
                      <input
                        type="datetime-local"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                    </div>

                    {/* Message to Buyer */}
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-xs font-bold text-zinc-700 dark:text-zinc-350">
                        Additional Message / Terms Summary
                      </label>
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="flex min-h-[80px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        placeholder="Explain quality standards, shipping logistics, or packaging details..."
                      />
                    </div>
                  </div>

                  {!connected && (
                    <div className="bg-amber-50 text-amber-800 border border-amber-200 text-xs rounded-xl p-3 flex gap-2">
                      <AlertCircle className="size-4 shrink-0 mt-0.5" />
                      <span>Freighter wallet disconnected. You can save terms as a local draft, but must connect your wallet to broadcast to buyers.</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-2">
                    <Button
                      onClick={() => handleSave(false)}
                      disabled={isSubmitting || !connected}
                      className="flex-1 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Send className="size-3.5" />
                      Send Proposal Terms
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleSave(true)}
                      disabled={isSubmitting}
                      className="flex-1 rounded-xl text-xs font-medium border-zinc-200"
                    >
                      <FileText className="size-3.5" />
                      {editingResponse ? "Update Draft" : "Save as Draft"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: History */}
          {activeTab === "history" && (
            <div className="space-y-4">
              {responses.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <History className="size-10 text-muted-foreground/35 mx-auto" />
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-350">No Proposal History</p>
                  <p className="text-xs text-muted-foreground leading-normal">
                    You haven't proposed any terms or saved drafts for this buyer intent yet.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {responses.map((resp) => (
                    <div
                      key={resp.id}
                      className="border dark:border-zinc-800 rounded-xl p-4 space-y-3 bg-zinc-50/20 dark:bg-zinc-950/10"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          ID: {resp.id}
                        </span>
                        <Badge
                          variant={
                            resp.status === "accepted"
                              ? "success"
                              : resp.status === "pending"
                                ? "warning"
                                : resp.status === "draft"
                                  ? "secondary"
                                  : "destructive"
                          }
                          className="capitalize text-[10px] font-semibold"
                        >
                          {resp.status}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs leading-normal">
                        <div>
                          <span className="text-muted-foreground">Price</span>
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {resp.pricePerUnit} XLM
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Quantity</span>
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {resp.quantityAvailable} {intent.unit}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Proposed Delivery</span>
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {new Date(resp.proposedDeliveryDate).toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {resp.message && (
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 bg-white/60 dark:bg-black/20 p-2.5 rounded-lg border leading-relaxed">
                          {resp.message}
                        </p>
                      )}

                      {/* Action Triggers */}
                      {resp.status === "draft" && (
                        <div className="flex gap-2 pt-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingResponse(resp);
                              setPricePerUnit(String(resp.pricePerUnit));
                              setQuantity(String(resp.quantityAvailable));
                              setDeliveryDate(resp.proposedDeliveryDate);
                              setMessage(resp.message || "");
                              setActiveTab("propose");
                            }}
                            className="text-xs rounded-lg border-zinc-200"
                          >
                            Edit Draft Terms
                          </Button>
                        </div>
                      )}

                      {resp.status === "pending" && (
                        <div className="flex gap-2 pt-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCancel(resp.id)}
                            className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50 rounded-lg"
                          >
                            Cancel Proposal
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
