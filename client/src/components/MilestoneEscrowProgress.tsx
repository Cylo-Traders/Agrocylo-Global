"use client";

import {
  CheckCircle2,
  Leaf,
  Package,
  Sprout,
  Sun,
  Truck,
  ChevronRight,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type MilestoneStep =
  | "planted"
  | "growing"
  | "harvested"
  | "shipped"
  | "delivered";

export const MILESTONE_ORDER: MilestoneStep[] = [
  "planted",
  "growing",
  "harvested",
  "shipped",
  "delivered",
];

const milestoneConfig: Record<
  MilestoneStep,
  { label: string; description: string; Icon: typeof Leaf }
> = {
  planted: {
    label: "Planted",
    description: "Crop has been planted for this order.",
    Icon: Sprout,
  },
  growing: {
    label: "Growing",
    description: "Crop is actively growing in the field.",
    Icon: Sun,
  },
  harvested: {
    label: "Harvested",
    description: "Produce has been harvested and prepared.",
    Icon: Leaf,
  },
  shipped: {
    label: "Shipped",
    description: "Order is in transit to the buyer.",
    Icon: Truck,
  },
  delivered: {
    label: "Delivered",
    description: "Order has been delivered successfully.",
    Icon: Package,
  },
};

export interface MilestoneEscrowProgressProps {
  /** Zero-based index of the current completed milestone; -1 or null = none yet */
  currentMilestoneIndex?: number | null;
  /** Farmer can advance; buyer is read-only */
  canAdvance?: boolean;
  onAdvance?: () => void | Promise<void>;
  isAdvancing?: boolean;
  className?: string;
  /** When true, show empty/fallback state for orders without milestone tracking */
  unavailable?: boolean;
}

export function MilestoneEscrowProgress({
  currentMilestoneIndex = -1,
  canAdvance = false,
  onAdvance,
  isAdvancing = false,
  className,
  unavailable = false,
}: MilestoneEscrowProgressProps) {
  const idx =
    currentMilestoneIndex == null || currentMilestoneIndex < 0
      ? -1
      : Math.min(currentMilestoneIndex, MILESTONE_ORDER.length - 1);

  const progressPct =
    idx < 0 ? 0 : Math.round(((idx + 1) / MILESTONE_ORDER.length) * 100);

  const currentStep = idx >= 0 ? MILESTONE_ORDER[idx] : null;
  const currentLabel = currentStep
    ? milestoneConfig[currentStep].label
    : "Not started";
  const isComplete = idx >= MILESTONE_ORDER.length - 1;
  const nextStep =
    idx >= 0 && idx < MILESTONE_ORDER.length - 1
      ? MILESTONE_ORDER[idx + 1]
      : idx < 0
        ? MILESTONE_ORDER[0]
        : null;

  if (unavailable) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base">Milestone Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Milestone tracking is not available for this order yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Milestone Progress</CardTitle>
          <Badge variant={isComplete ? "success" : "secondary"} className="gap-1.5" data-testid="milestone-current-status">
            {isComplete ? (
              <CheckCircle2 className="size-3.5" />
            ) : null}
            {currentLabel}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {currentStep
            ? milestoneConfig[currentStep].description
            : "Awaiting the first production milestone."}
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <div className="text-muted-foreground flex justify-between text-xs">
            <span>Progress</span>
            <span>{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        <div className="flex items-center gap-1">
          {MILESTONE_ORDER.map((step, i) => {
            const cfg = milestoneConfig[step];
            const isActive = i === idx;
            const isPast = i < idx;
            return (
              <div key={step} className="flex flex-1 items-center gap-1">
                <div
                  className={cn(
                    "grid size-8 shrink-0 place-content-center rounded-full text-xs transition-colors",
                    isActive && "bg-primary text-primary-foreground",
                    isPast && "bg-primary/30 text-primary",
                    !isActive && !isPast && "bg-muted text-muted-foreground",
                  )}
                  title={cfg.label}
                  data-testid={`milestone-${step}`}
                  data-state={isActive ? "active" : isPast ? "past" : "future"}
                >
                  <cfg.Icon className="size-4" />
                </div>
                {i < MILESTONE_ORDER.length - 1 && (
                  <div
                    className={cn(
                      "h-px flex-1",
                      isPast || isActive ? "bg-primary/40" : "bg-border",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="text-muted-foreground grid grid-cols-5 gap-1 text-center text-[10px]">
          {MILESTONE_ORDER.map((s) => (
            <span key={s}>{milestoneConfig[s].label}</span>
          ))}
        </div>

        {canAdvance && !isComplete && nextStep && (
          <Button
            className="w-full"
            onClick={() => void onAdvance?.()}
            isLoading={isAdvancing}
            disabled={isAdvancing}
          >
            Advance to {milestoneConfig[nextStep].label}
            <ChevronRight className="size-4" />
          </Button>
        )}

        {!canAdvance && !isComplete && (
          <p className="text-muted-foreground text-center text-xs">
            The farmer advances milestones as production progresses.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default MilestoneEscrowProgress;
