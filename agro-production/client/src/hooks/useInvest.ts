import { useState } from 'react';
import { invest } from '@/lib/investService';
import { classifyError, logErrorWithContext } from '@/lib/errorHandling';

export function useInvest() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const investFn = async (productId: string, amount: number) => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await invest(productId, amount);
      setSuccess(true);
    } catch (error: unknown) {
      const classified = classifyError(error, "invest");
      logErrorWithContext(error, {
        feature: "investment",
        action: "invest",
        productId,
        amount,
        category: classified.category,
      });
      setError(classified.actionableMessage);
    } finally {
      setLoading(false);
    }
  };

  return { invest: investFn, loading, error, success };
}
