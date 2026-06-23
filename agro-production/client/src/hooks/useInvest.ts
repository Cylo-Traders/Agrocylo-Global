import { useState, useCallback, useRef } from "react";
import { recordInvestment } from "@/lib/investService";
import { buildInvestTransaction } from "@/lib/contractService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import { classifyError, logErrorWithContext } from "@/lib/errorHandling";
import {
  idleInvestMachine,
  advanceInvestMachine,
  type InvestMachineState,
} from "@/types/transaction";

export function useInvest() {
  const [machine, setMachine] = useState<InvestMachineState>(idleInvestMachine());
  const inProgressRef = useRef(false);

  const reset = useCallback(() => {
    setMachine(idleInvestMachine());
    inProgressRef.current = false;
  }, []);

  const investFn = async (
    campaignId: string,
    campaignOnChainId: string,
    investorAddress: string,
    amount: bigint,
  ) => {
    if (inProgressRef.current) {
      throw new Error("Duplicate submission");
    }
    inProgressRef.current = true;

    let current = advanceInvestMachine(idleInvestMachine(), "building");
    setMachine(current);

    try {
      // 1. Build transaction
      const buildResult = await buildInvestTransaction(investorAddress, campaignOnChainId, amount);
      if (!buildResult.success || !buildResult.data) {
        throw new Error(buildResult.error || "Failed to build transaction");
      }

      // 2. Request signature
      current = advanceInvestMachine(current, "signing");
      setMachine(current);

      // signAndSubmitTransaction handles signing, submitting, and confirming internally.
      // We advance state to submitting before calling it because we can't easily break
      // apart the freighter signing prompt vs network submit inside the library without refactoring it.
      // However, we can quickly transition to submitting since it handles everything.
      current = advanceInvestMachine(current, "submitting");
      setMachine(current);

      const signResult = await signAndSubmitTransaction(buildResult.data);
      if (!signResult.success) {
        throw new Error(signResult.error || "Transaction failed");
      }

      current = advanceInvestMachine(current, "confirming", { txHash: signResult.txHash });
      setMachine(current);

      // 3. Refresh indexed record
      current = advanceInvestMachine(current, "refreshing");
      setMachine(current);

      await recordInvestment(campaignId, investorAddress, amount);

      current = advanceInvestMachine(current, "success");
      setMachine(current);
    } catch (error: unknown) {
      const classified = classifyError(error, "invest");
      logErrorWithContext(error, {
        feature: "investment",
        action: "invest",
        campaignId,
        investorAddress,
        amount: amount.toString(),
        category: classified.category,
      });

      current = advanceInvestMachine(current, "failed", { error: classified.actionableMessage });
      setMachine(current);
    }
  };

  return {
    machine,
    invest: investFn,
    reset,
  };
}
