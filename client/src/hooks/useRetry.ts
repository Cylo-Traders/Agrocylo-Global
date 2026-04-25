"use client";

import { useState, useCallback } from "react";

interface UseRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Hook that wraps an async operation with automatic retry and exponential backoff.
 *
 * @example
 * const { execute, isRetrying, attempt } = useRetry({ maxRetries: 3 });
 *
 * const handleFetch = () => execute(async () => {
 *   const data = await fetchProducts();
 *   setProducts(data);
 * });
 */
export function useRetry(options: UseRetryOptions = {}) {
  const { maxRetries = 3, baseDelayMs = 1000 } = options;
  const [isRetrying, setIsRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const execute = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setIsRetrying(true);
      setAttempt(0);

      for (let i = 0; i <= maxRetries; i++) {
        setAttempt(i + 1);
        try {
          await fn();
          setIsRetrying(false);
          setAttempt(0);
          return;
        } catch (err) {
          if (i === maxRetries) {
            setIsRetrying(false);
            throw err;
          }
          const delay = baseDelayMs * Math.pow(2, i);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    },
    [maxRetries, baseDelayMs],
  );

  return { execute, isRetrying, attempt };
}
