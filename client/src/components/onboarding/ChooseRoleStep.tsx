"use client";

import { Button } from "@/components/ui/button";
import { ShoppingCart, Tractor } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChooseRoleStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onRoleSelect: (role: "BUYER" | "FARMER") => void;
  selectedRole: "BUYER" | "FARMER" | null;
}

export default function ChooseRoleStep({
  onNext,
  onBack,
  onSkip,
  onRoleSelect,
  selectedRole,
}: ChooseRoleStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Choose Your Role</h2>
        <p className="text-muted-foreground">
          Are you buying or selling agricultural products?
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => onRoleSelect("BUYER")}
          className={cn(
            "p-6 rounded-lg border-2 transition-all hover:border-primary/50 text-left",
            selectedRole === "BUYER"
              ? "border-primary bg-primary/5"
              : "border-border",
          )}
        >
          <div className="flex flex-col items-center text-center space-y-3">
            <div
              className={cn(
                "p-3 rounded-full",
                selectedRole === "BUYER" ? "bg-primary/10" : "bg-muted",
              )}
            >
              <ShoppingCart
                className={cn(
                  "h-8 w-8",
                  selectedRole === "BUYER"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-1">I'm a Buyer</h3>
              <p className="text-sm text-muted-foreground">
                Purchase fresh produce directly from farmers
              </p>
            </div>
            <ul className="text-sm text-muted-foreground space-y-1 text-left w-full">
              <li>• Browse available products</li>
              <li>• Place secure orders</li>
              <li>• Track deliveries</li>
              <li>• Rate farmers</li>
            </ul>
          </div>
        </button>

        <button
          onClick={() => onRoleSelect("FARMER")}
          className={cn(
            "p-6 rounded-lg border-2 transition-all hover:border-primary/50 text-left",
            selectedRole === "FARMER"
              ? "border-primary bg-primary/5"
              : "border-border",
          )}
        >
          <div className="flex flex-col items-center text-center space-y-3">
            <div
              className={cn(
                "p-3 rounded-full",
                selectedRole === "FARMER" ? "bg-primary/10" : "bg-muted",
              )}
            >
              <Tractor
                className={cn(
                  "h-8 w-8",
                  selectedRole === "FARMER"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-1">I'm a Farmer</h3>
              <p className="text-sm text-muted-foreground">
                Sell your produce directly to buyers
              </p>
            </div>
            <ul className="text-sm text-muted-foreground space-y-1 text-left w-full">
              <li>• List your products</li>
              <li>• Receive orders</li>
              <li>• Get paid securely</li>
              <li>• Build reputation</li>
            </ul>
          </div>
        </button>
      </div>

      <div className="p-4 rounded-lg border bg-muted/50">
        <p className="text-sm text-muted-foreground">
          <strong>Note:</strong> You can change your role later in your profile
          settings.
        </p>
      </div>

      <div className="flex gap-3 justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
          <Button onClick={onNext} disabled={!selectedRole}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
