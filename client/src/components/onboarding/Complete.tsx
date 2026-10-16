"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { useEffect } from "react";
import { useAnalytics } from "@/hooks/useAnalytics";

interface CompleteProps {
  role: "farmer" | "buyer";
}

export default function Complete({ role }: CompleteProps) {
  const isFarmer = role === "farmer";
  const router = useRouter();
  const { trackFunnelStep } = useAnalytics();

  useEffect(() => {
    trackFunnelStep("onboarding_completion", "completed", { role });
  }, [role, trackFunnelStep]);

  // Send the user straight to their destination once onboarding is done. The
  // confirmation UI below stays mounted so it is visible for the brief moment
  // before navigation (or if the redirect is somehow blocked).
  useEffect(() => {
    router.replace(isFarmer ? "/dashboard" : "/market");
  }, [isFarmer, router]);

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="bg-primary/10 grid size-16 place-content-center rounded-full">
          <CheckCircle2 className="text-primary size-8" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">You&apos;re All Set!</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {isFarmer
              ? "Your farmer profile is live. Buyers can now find you on the map."
              : "Your profile is ready. Explore the marketplace to find local produce."}
          </p>
        </div>

        <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
          <Link
            href={isFarmer ? "/dashboard" : "/market"}
            onClick={() =>
              trackFunnelStep("onboarding_completion", "post_completion_primary", {
                role,
              })
            }
            className={buttonVariants({ className: "flex-1" })}
          >
            {isFarmer ? "Go to Dashboard" : "Browse Marketplace"}
          </Link>
          <Link
            href="/map"
            onClick={() =>
              trackFunnelStep("onboarding_completion", "post_completion_map", {
                role,
              })
            }
            className={buttonVariants({ variant: "outline", className: "flex-1" })}
          >
            View Farmer Map
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
