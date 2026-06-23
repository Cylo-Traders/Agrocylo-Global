/** Transaction state machine types for the checkout flow.
 *
 * Steps in order: record (off-chain) → sign (wallet) → submit (on-chain) → confirm
 * Each step can be idle, active, done, or error.
 * The machine enforces forward-only transitions; you cannot skip a step.
 */

export type TxStep = "record" | "sign" | "submit" | "confirm";
export type StepStatus = "idle" | "active" | "done" | "error";

export type TxStepState = Record<TxStep, StepStatus>;

export type TxPhase =
  | "idle"
  | "recording"   // creating off-chain order
  | "signing"     // waiting for wallet signature
  | "submitting"  // broadcasting to Stellar
  | "confirming"  // waiting for ledger inclusion
  | "success"
  | "failed";

export interface TxMachineState {
  phase: TxPhase;
  steps: TxStepState;
  txHash?: string;
  error?: string;
}

const IDLE_STEPS: TxStepState = {
  record: "idle",
  sign: "idle",
  submit: "idle",
  confirm: "idle",
};

export function idleMachine(): TxMachineState {
  return { phase: "idle", steps: { ...IDLE_STEPS } };
}

/** Advance the machine to the next phase, enforcing valid transitions. */
export function advanceMachine(
  current: TxMachineState,
  to: TxPhase,
  extra?: { txHash?: string; error?: string },
): TxMachineState {
  const VALID: Record<TxPhase, TxPhase[]> = {
    idle:       ["recording"],
    recording:  ["signing", "failed"],
    signing:    ["submitting", "failed"],
    submitting: ["confirming", "success", "failed"],
    confirming: ["success", "failed"],
    success:    [],
    failed:     ["idle"],
  };

  if (!VALID[current.phase].includes(to)) {
    console.warn(`[TxMachine] invalid transition ${current.phase} → ${to}`);
    return current;
  }

  const steps: TxStepState = { ...current.steps };

  switch (to) {
    case "recording":
      steps.record = "active";
      break;
    case "signing":
      steps.record = "done";
      steps.sign = "active";
      break;
    case "submitting":
      steps.sign = "done";
      steps.submit = "active";
      break;
    case "confirming":
      steps.submit = "done";
      steps.confirm = "active";
      break;
    case "success":
      // mark the last active step as done
      if (steps.confirm === "active") steps.confirm = "done";
      else if (steps.submit === "active") steps.submit = "done";
      break;
    case "failed":
      // mark the current active step as error
      for (const k of (["confirm", "submit", "sign", "record"] as TxStep[])) {
        if (steps[k] === "active") { steps[k] = "error"; break; }
      }
      break;
    case "idle":
      return idleMachine();
  }

  return { phase: to, steps, txHash: extra?.txHash, error: extra?.error };
}

/** Investment state machine types */

export type InvestStep = "build" | "sign" | "submit" | "confirm" | "refresh";
export type InvestStepState = Record<InvestStep, StepStatus>;

export type InvestPhase =
  | "idle"
  | "building"    // building transaction
  | "signing"     // waiting for wallet signature
  | "submitting"  // broadcasting to Stellar
  | "confirming"  // waiting for ledger inclusion
  | "refreshing"  // updating indexer / db
  | "success"
  | "failed";

export interface InvestMachineState {
  phase: InvestPhase;
  steps: InvestStepState;
  txHash?: string;
  error?: string;
}

const IDLE_INVEST_STEPS: InvestStepState = {
  build: "idle",
  sign: "idle",
  submit: "idle",
  confirm: "idle",
  refresh: "idle",
};

export function idleInvestMachine(): InvestMachineState {
  return { phase: "idle", steps: { ...IDLE_INVEST_STEPS } };
}

export function advanceInvestMachine(
  current: InvestMachineState,
  to: InvestPhase,
  extra?: { txHash?: string; error?: string },
): InvestMachineState {
  const VALID: Record<InvestPhase, InvestPhase[]> = {
    idle:       ["building"],
    building:   ["signing", "failed"],
    signing:    ["submitting", "failed"],
    submitting: ["confirming", "success", "failed"],
    confirming: ["refreshing", "success", "failed"],
    refreshing: ["success", "failed"],
    success:    [],
    failed:     ["idle"],
  };

  if (!VALID[current.phase].includes(to)) {
    console.warn(`[InvestMachine] invalid transition ${current.phase} → ${to}`);
    return current;
  }

  const steps: InvestStepState = { ...current.steps };

  switch (to) {
    case "building":
      steps.build = "active";
      break;
    case "signing":
      steps.build = "done";
      steps.sign = "active";
      break;
    case "submitting":
      steps.sign = "done";
      steps.submit = "active";
      break;
    case "confirming":
      steps.submit = "done";
      steps.confirm = "active";
      break;
    case "refreshing":
      steps.confirm = "done";
      steps.refresh = "active";
      break;
    case "success":
      if (steps.refresh === "active") steps.refresh = "done";
      else if (steps.confirm === "active") steps.confirm = "done";
      else if (steps.submit === "active") steps.submit = "done";
      break;
    case "failed":
      for (const k of (["refresh", "confirm", "submit", "sign", "build"] as InvestStep[])) {
        if (steps[k] === "active") { steps[k] = "error"; break; }
      }
      break;
    case "idle":
      return idleInvestMachine();
  }

  return { phase: to, steps, txHash: extra?.txHash, error: extra?.error };
}
