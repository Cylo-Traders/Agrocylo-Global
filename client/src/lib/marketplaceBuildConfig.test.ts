import { describe, expect, it } from "vitest";
import { assertMarketplaceBuildConfig } from "./marketplaceBuildConfig";

const validProductionConfig = {
  NEXT_PUBLIC_CONTRACT_ID: "CESCROW",
  NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID: "CNATIVE",
  NEXT_PUBLIC_DEMO_MODE: "false",
};

describe("marketplace production build configuration", () => {
  it("accepts configured contract IDs with demo mode disabled", () => {
    expect(() =>
      assertMarketplaceBuildConfig(validProductionConfig, true),
    ).not.toThrow();
  });

  it.each([
    ["NEXT_PUBLIC_CONTRACT_ID", { ...validProductionConfig, NEXT_PUBLIC_CONTRACT_ID: "" }],
    ["NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID", { ...validProductionConfig, NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID: "" }],
  ] as const)("fails production builds when %s is missing", (_name, config) => {
    expect(() => assertMarketplaceBuildConfig(config, true)).toThrow(_name);
  });

  it("rejects demo mode in production and allows it in development", () => {
    expect(() =>
      assertMarketplaceBuildConfig(
        { ...validProductionConfig, NEXT_PUBLIC_DEMO_MODE: "true" },
        true,
      ),
    ).toThrow("NEXT_PUBLIC_DEMO_MODE=false");
    expect(() =>
      assertMarketplaceBuildConfig(
        { NEXT_PUBLIC_DEMO_MODE: "true" },
        false,
      ),
    ).not.toThrow();
  });
});
