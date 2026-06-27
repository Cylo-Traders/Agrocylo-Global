"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isContractConfigured } from "@/services/stellar/networkConfig";

interface ContractGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function ContractGuard({ children, fallback }: ContractGuardProps) {
  if (isContractConfigured()) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-destructive" />
          <CardTitle className="text-base">Contract Not Configured</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The escrow smart contract address has not been set. Contract-dependent
          features such as creating orders, confirming delivery, and disputes
          require the <code className="bg-muted rounded px-1 text-xs">NEXT_PUBLIC_CONTRACT_ID</code> environment variable.
        </p>
        <p className="text-sm text-muted-foreground">
          To configure it, add the following to your <code className="bg-muted rounded px-1 text-xs">.env.local</code> file:
        </p>
        <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs">
          NEXT_PUBLIC_CONTRACT_ID=your_deployed_contract_address
        </pre>
        <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
          <Settings className="size-3" />
          <span>
            See the project README or <code className="bg-muted rounded px-1">.env.example</code> for more details.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
