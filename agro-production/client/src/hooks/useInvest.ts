import { useState } from 'react';
import { invest } from '@/lib/investService';

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
    } catch (e: any) {
      setError(e?.message ?? 'Investment failed');
    } finally {
      setLoading(false);
    }
  };

  return { invest: investFn, loading, error, success };
}
