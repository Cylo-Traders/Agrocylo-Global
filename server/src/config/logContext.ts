import { AsyncLocalStorage } from "node:async_hooks";

export type LogContext = {
  requestId?: string;
  job?: {
    queue: string;
    jobId: string;
    name?: string;
  };
};

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const current = storage.getStore() ?? {};
  return storage.run({ ...current, ...ctx }, fn);
}

export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

