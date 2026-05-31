"use client";

import { useEffect, useState, useMemo } from "react";
import {
  MapPin,
  Search,
  Star,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { BuyerIntent } from "@/types/demand";
import { ProductCategory } from "@/types/product";
import { cn } from "@/lib/utils";
import { useAnalytics } from "@/hooks/useAnalytics";
import BuyerIntentResponse from "./BuyerIntentResponse";

type SortKey = "date" | "volume" | "rating";

const CATEGORIES: Array<ProductCategory | "All"> = [
  "All",
  "Grains",
  "Tubers",
  "Vegetables",
  "Fruits",
  "Livestock",
  "Other",
];

interface BuyerIntentsProps {
  intents: BuyerIntent[];
}

function StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "size-3",
            i < full ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
          )}
        />
      ))}
      <span className="text-muted-foreground ml-1 text-[10px]">{rating.toFixed(1)}</span>
    </span>
  );
}

function IntentCard({ intent }: { intent: BuyerIntent }) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div
      className={cn(
        "bg-secondary/40 rounded-xl border transition-colors",
        expanded ? "border-primary/40" : "hover:border-primary/20",
      )}
    >
      {/* Header row — always visible */}
      <button
        className="w-full p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{intent.product_name}</h3>
              {intent.is_recurring && (
                <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-medium">
                  Recurring
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {intent.buyer_name}
            </p>
            {intent.buyer_rating !== undefined && (
              <div className="mt-1">
                <StarRating rating={intent.buyer_rating} />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {intent.category}
            </Badge>
            {expanded ? (
              <ChevronUp className="text-muted-foreground size-4" />
            ) : (
              <ChevronDown className="text-muted-foreground size-4" />
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-primary font-medium">
              {intent.quantity} {intent.unit}
            </span>
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <MapPin className="size-3" />
              {intent.location.region}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            {new Date(intent.created_at).toLocaleDateString()}
          </p>
        </div>
      </button>

      {/* Expandable detail */}
      {expanded && (
        <>
          <Separator />
          <div className="space-y-3 px-4 pb-4 pt-3">
            {intent.timeline && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground w-28 shrink-0 font-medium">Timeline</span>
                <span>{intent.timeline}</span>
              </div>
            )}
            {intent.budget_range && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground w-28 shrink-0 font-medium">Budget</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  {intent.budget_range}
                </span>
              </div>
            )}
            {intent.quality_requirements && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground w-28 shrink-0 font-medium">Quality</span>
                <span className="text-muted-foreground">{intent.quality_requirements}</span>
              </div>
            )}
            {intent.delivery_preference && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground w-28 shrink-0 font-medium">Delivery</span>
                <span>{intent.delivery_preference}</span>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button size="sm" className="flex-1 text-xs" onClick={() => setModalOpen(true)}>
                Express Interest
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setModalOpen(true)}>
                Contact Buyer
              </Button>
            </div>
          </div>
          <BuyerIntentResponse
            intent={intent}
            isOpen={modalOpen}
            onClose={() => setModalOpen(false)}
          />
        </>
      )}
    </div>
  );
}

export function BuyerIntents({ intents }: BuyerIntentsProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ProductCategory | "All">("All");
  const [sort, setSort] = useState<SortKey>("date");
  const { trackFilterUsage, trackSearchQuery, trackFeatureAdoption } =
    useAnalytics();

  const displayed = useMemo(() => {
    let result = intents.filter((i) => {
      if (category !== "All" && i.category !== category) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          i.product_name.toLowerCase().includes(q) ||
          i.buyer_name.toLowerCase().includes(q) ||
          i.location.region.toLowerCase().includes(q) ||
          (i.category?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      if (sort === "date") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sort === "volume") {
        return Number(b.quantity) - Number(a.quantity);
      }
      if (sort === "rating") {
        return (b.buyer_rating ?? 0) - (a.buyer_rating ?? 0);
      }
      return 0;
    });

    return result;
  }, [intents, search, category, sort]);

  useEffect(() => {
    const trimmed = search.trim();
    if (!trimmed) return;
    const timer = setTimeout(() => {
      trackSearchQuery(trimmed, { source: "buyer-intents" });
    }, 400);
    return () => clearTimeout(timer);
  }, [search, trackSearchQuery]);

  useEffect(() => {
    trackFilterUsage("buyer_intents_category", category, {
      source: "buyer-intents",
    });
  }, [category, trackFilterUsage]);

  useEffect(() => {
    trackFilterUsage("buyer_intents_sort", sort, {
      source: "buyer-intents",
    });
  }, [sort, trackFilterUsage]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Open Buyer Intents</CardTitle>
          <Badge variant="secondary">{displayed.length} active</Badge>
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Search product, buyer, region…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Category filter */}
        <div className="mt-2 flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
              <button
                key={c}
              onClick={() => {
                trackFeatureAdoption("buyer_intents_filter", {
                  category: c,
                });
                setCategory(c);
              }}
                className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                category === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-muted-foreground text-[11px]">Sort:</span>
          {(["date", "volume", "rating"] as SortKey[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                trackFeatureAdoption("buyer_intents_sort", {
                  sort: s,
                });
                setSort(s);
              }}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition-colors",
                sort === s
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
          {(search || category !== "All") && (
            <button
              onClick={() => {
                trackFilterUsage("buyer_intents_reset", "reset", {
                  source: "buyer-intents",
                });
                setSearch("");
                setCategory("All");
              }}
              className="text-muted-foreground ml-auto flex items-center gap-1 text-[11px] hover:text-foreground"
            >
              <RotateCcw className="size-3" /> Reset
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {displayed.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No buyer intents match your filters.
          </p>
        ) : (
          displayed.map((intent) => (
            <IntentCard key={intent.id} intent={intent} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
