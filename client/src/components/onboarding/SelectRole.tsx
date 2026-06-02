"use client";

import { Sprout, ShoppingBag } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAnalytics } from "@/hooks/useAnalytics";

interface SelectRoleProps {
  selected: "farmer" | "buyer" | null;
  onSelect: (role: "farmer" | "buyer") => void;
  onNext: () => void;
  onBack: () => void;
}

const options: Array<{
  value: "farmer" | "buyer";
  title: string;
  blurb: string;
  Icon: typeof Sprout;
}> = [
  {
    value: "farmer",
    title: "I'm a Farmer",
    blurb: "Sell produce via Stellar escrow",
    Icon: Sprout,
  },
  {
    value: "buyer",
    title: "I'm a Buyer",
    blurb: "Buy directly from local farmers",
    Icon: ShoppingBag,
  },
];

export default function SelectRole({
  selected,
  onSelect,
  onNext,
  onBack,
}: SelectRoleProps) {
  const { trackFunnelStep } = useAnalytics();

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Choose Your Role</CardTitle>
        <CardDescription>This cannot be changed later.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {options.map(({ value, title, blurb, Icon }) => (
            <button
              key={value}
              onClick={() => {
                trackFunnelStep("onboarding_completion", "role_selected", {
                  role: value,
                });
                onSelect(value);
              }}
              className={cn(
                "group flex min-h-11 flex-col items-center gap-2 rounded-2xl border-2 p-5 text-center transition-all sm:p-6",
                selected === value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-foreground/30",
              )}
            >
              <div
                className={cn(
                  "grid size-12 place-content-center rounded-full transition",
                  selected === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground group-hover:bg-foreground/5",
                )}
              >
                <Icon className="size-6" />
              </div>
              <span className="font-semibold">{title}</span>
              <span className="text-muted-foreground text-xs">{blurb}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => {
              trackFunnelStep("onboarding_completion", "role_step_back");
              onBack();
            }}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            disabled={!selected}
            onClick={() => {
              trackFunnelStep("onboarding_completion", "role_step_continued", {
                selected: Boolean(selected),
              });
              onNext();
            }}
            className="flex-[2]"
          >
            Continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
