"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface CompleteProps {
  role: "farmer" | "buyer";
}

export default function Complete({ role }: CompleteProps) {
  return (
    <Card variant="elevated" padding="lg" className="max-w-md mx-auto text-center">
      <div className="text-5xl mb-4">{role === "farmer" ? "🌾" : "🛒"}</div>
      <h2 className="text-2xl font-bold text-foreground mb-2">
        You&apos;re All Set!
      </h2>
      <p className="text-muted text-sm mb-6">
        {role === "farmer"
          ? "Your profile is live. Buyers can now find you on the map."
          : "Your profile is ready. Explore the farmer map to find local produce."}
      </p>

      <Link href={role === "farmer" ? "/map" : "/map"}>
        <Button variant="primary" fullWidth>
          {role === "farmer" ? "View My Pin on the Map" : "Explore Farmer Map"}
        </Button>
      </Link>
    </Card>
  );
}
