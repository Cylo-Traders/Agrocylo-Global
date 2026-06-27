/**
 * Validates that the contract watcher has the required environment config.
 * Throws at startup so misconfigured instances fail immediately rather than
 * silently running without an active watcher.
 */
export function validateContractWatcherConfig(runWatcher: boolean, contractId: string): void {
  if (runWatcher && !contractId) {
    throw new Error(
      "CONTRACT_ID is required when RUN_CONTRACT_WATCHER is enabled. " +
      "Set CONTRACT_ID in your .env, or set RUN_CONTRACT_WATCHER=false for REST-only mode.",
    );
  }
}
