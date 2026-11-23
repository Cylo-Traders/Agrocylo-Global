export interface MarketplaceBuildEnvironment {
  NEXT_PUBLIC_CONTRACT_ID?: string;
  NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID?: string;
  NEXT_PUBLIC_DEMO_MODE?: string;
}

export function assertMarketplaceBuildConfig(
  env: MarketplaceBuildEnvironment,
  isProduction: boolean,
): void {
  if (!isProduction) return;

  const missing = (
    [
      "NEXT_PUBLIC_CONTRACT_ID",
      "NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID",
    ] as const
  ).filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Production build requires ${missing.join(" and ")}. Set these to deployed contract IDs from the target network manifest.`,
    );
  }
  if (env.NEXT_PUBLIC_DEMO_MODE !== "false") {
    throw new Error(
      "Production build requires NEXT_PUBLIC_DEMO_MODE=false.",
    );
  }
}
