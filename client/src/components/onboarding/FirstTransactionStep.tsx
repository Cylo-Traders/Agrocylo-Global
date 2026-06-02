"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle, ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";

interface FirstTransactionStepProps {
  onComplete: () => void;
  onBack: () => void;
  onSkip: () => void;
  role: "BUYER" | "FARMER";
}

export default function FirstTransactionStep({
  onComplete,
  onBack,
  onSkip,
  role,
}: FirstTransactionStepProps) {
  const buyerActions = [
    {
      title: "Browse the Marketplace",
      description: "Explore available products from local farmers",
      link: "/market",
      icon: "🛒",
    },
    {
      title: "Make Your First Purchase",
      description: "Place an order and experience secure escrow payments",
      link: "/market",
      icon: "💳",
    },
    {
      title: "Track Your Order",
      description: "Monitor delivery status and confirm receipt",
      link: "/dashboard",
      icon: "📦",
    },
  ];

  const farmerActions = [
    {
      title: "List Your First Product",
      description: "Add your produce with photos and pricing",
      link: "/dashboard",
      icon: "🌾",
    },
    {
      title: "Receive Orders",
      description: "Get notified when buyers place orders",
      link: "/dashboard",
      icon: "📬",
    },
    {
      title: "Complete Delivery",
      description: "Mark as delivered and receive payment automatically",
      link: "/dashboard",
      icon: "✅",
    },
  ];

  const actions = role === "BUYER" ? buyerActions : farmerActions;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex p-3 rounded-full bg-primary/10 mb-4">
          <CheckCircle className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
        <p className="text-muted-foreground">
          {role === "BUYER"
            ? "Start exploring and make your first purchase"
            : "Start listing products and receive your first order"}
        </p>
      </div>

      <div className="space-y-3">
        {actions.map((action, index) => (
          <div
            key={index}
            className="p-4 rounded-lg border flex items-start gap-4 hover:border-primary/50 transition-colors"
          >
            <div className="text-3xl">{action.icon}</div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">{action.title}</h3>
              <p className="text-sm text-muted-foreground">
                {action.description}
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>
        ))}
      </div>

      <div className="p-4 rounded-lg border bg-blue-50 dark:bg-blue-950/20">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <span>📚</span> Need Help?
        </h3>
        <p className="text-sm text-muted-foreground mb-2">
          Check out our guides and documentation
        </p>
        <a
          href="/about"
          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
        >
          Learn More <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="flex gap-3 justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
          <Button onClick={onComplete} size="lg">
            Start Using AgroCylo
          </Button>
        </div>
      </div>
    </div>
  );
}
