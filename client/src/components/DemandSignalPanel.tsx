"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Container, Text } from "@/components/ui";
import { DemandVolume } from "./DemandVolume";
import { BuyerIntents } from "./BuyerIntents";
import { getDemandData } from "@/services/demandService";
import { DemandData } from "@/types/demand";

const RegionalHeatMap = dynamic(() => import("./RegionalHeatMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] w-full animate-pulse bg-surface rounded-xl border border-border flex items-center justify-center">
      <Text muted>Loading Heat Map...</Text>
    </div>
  ),
});

export function DemandSignalPanel() {
  const [data, setData] = useState<DemandData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await getDemandData();
        setData(result);
      } catch (error) {
        console.error("Failed to fetch demand data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  if (isLoading) {
    return (
      <Container size="lg" className="py-8">
        <Text variant="h2" className="mb-8">
          Aggregated Buyer Demand 📊
        </Text>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
           <div className="space-y-8">
             <div className="h-64 bg-surface animate-pulse rounded-xl" />
             <div className="h-96 bg-surface animate-pulse rounded-xl" />
           </div>
           <div className="h-[500px] bg-surface animate-pulse rounded-xl" />
        </div>
      </Container>
    );
  }

  if (!data) return null;

  return (
    <Container size="lg" className="py-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <Text variant="h1" as="h1" className="mb-2">
            Demand Signal Panel 🌾
          </Text>
          <Text variant="body" muted>
            Real-time aggregate data on buyer intents and market volume.
          </Text>
        </div>
        <div className="bg-primary-50 px-4 py-2 rounded-lg border border-primary-100 flex items-center gap-2">
           <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
           <Text variant="caption" className="text-primary-800 font-medium">
             Live Updates Enabled
           </Text>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-8">
          <DemandVolume data={data.volume} />
          <BuyerIntents intents={data.intents} />
        </div>
        <div className="lg:col-span-2">
          <RegionalHeatMap data={data.heatMap} />
          <div className="mt-8 p-6 rounded-xl bg-accent-50 border border-accent-100">
             <Text variant="h4" className="text-accent-900 mb-2">
               Insights summary
             </Text>
             <Text variant="bodySmall" className="text-accent-800">
               High demand for Grains in the North Central region (Abuja). Demand for Tubers is growing in the South West (Lagos). Current market trend shows a 12% increase in total buyer intents over the last 24 hours.
             </Text>
          </div>
        </div>
      </div>
    </Container>
  );
}
