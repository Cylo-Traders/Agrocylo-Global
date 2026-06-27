import { describe, it, expect } from "vitest";
import { validateContractWatcherConfig } from "./validateContractWatcher.js";

describe("validateContractWatcherConfig", () => {
  it("throws when RUN_CONTRACT_WATCHER is true and CONTRACT_ID is empty", () => {
    expect(() => validateContractWatcherConfig(true, "")).toThrow(
      "CONTRACT_ID is required when RUN_CONTRACT_WATCHER is enabled",
    );
  });

  it("does not throw when watcher is disabled and CONTRACT_ID is empty", () => {
    expect(() => validateContractWatcherConfig(false, "")).not.toThrow();
  });

  it("does not throw when watcher is enabled and CONTRACT_ID is provided", () => {
    expect(() => validateContractWatcherConfig(true, "CTEST123456789")).not.toThrow();
  });

  it("does not throw when watcher is disabled and CONTRACT_ID is provided", () => {
    expect(() => validateContractWatcherConfig(false, "CTEST123456789")).not.toThrow();
  });
});
