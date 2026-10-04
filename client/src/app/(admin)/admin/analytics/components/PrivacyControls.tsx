"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

interface PrivacyControlsProps {
  consent: string;
  setConsent: (consent: "granted" | "denied") => void;
  refresh: () => void;
  snapshot: { updatedAt: string };
}

export function PrivacyControls({
  consent,
  setConsent,
  refresh,
  snapshot,
}: PrivacyControlsProps) {
  return (
    <section className="rounded-2xl border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Privacy Controls</h2>
          <p className="text-muted-foreground text-sm">
            Enable or disable local analytics on this device.
          </p>
        </div>
      </div>
      <Separator className="my-4" />
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
          <div>
            <p className="font-medium">Collection</p>
            <p className="text-muted-foreground text-sm">
              Consent is stored locally and respected across reloads.
            </p>
          </div>
          <Switch
            checked={consent === "granted"}
            onCheckedChange={(checked) => setConsent(checked ? "granted" : "denied")}
          />
        </div>
        <div className="rounded-xl bg-secondary/40 p-4 text-sm">
          <p className="font-medium">Latest snapshot</p>
          <p className="text-muted-foreground mt-1">
            Updated at {new Date(snapshot.updatedAt).toLocaleString()}.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => void refresh()}>
          Refresh live metrics
        </Button>
      </div>
    </section>
  );
}
