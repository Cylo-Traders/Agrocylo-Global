import { useState, useEffect } from 'react';
import { useInvest } from '@/hooks/useInvest';

interface InvestmentModalProps {
  open: boolean;
  onClose: () => void;
  productId: string;
}

export default function InvestmentModal({ open, onClose, productId }: InvestmentModalProps) {
  const [amount, setAmount] = useState('');
  const { invest, loading, error, success } = useInvest();

  const handleInvest = async () => {
    const value = Number(amount);
    if (!value || value <= 0) return;
    await invest(productId, value);
  };

  // Auto‑close after a short success flash
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        onClose();
        setAmount('');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [success, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm z-50">
      <div className="bg-[var(--color-background)] text-[var(--color-foreground)] p-6 rounded-lg shadow-xl max-w-sm w-full">
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-primary-600)' }}>
          Invest in product
        </h2>
        <input
          type="number"
          min="1"
          placeholder="Amount"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="w-full p-2 border border-[var(--color-neutral-200)] rounded mb-4"
        />
        <button
          onClick={handleInvest}
          disabled={loading}
          className="w-full py-2 bg-[var(--color-primary-600)] text-white rounded hover:bg-[var(--color-primary-700)] disabled:opacity-50"
        >
          {loading ? 'Investing…' : 'Invest'}
        </button>
        {error && (
          <p className="mt-2 text-sm text-[var(--color-error)]" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="mt-2 text-sm text-[var(--color-success)]" role="status">
            Investment successful!
          </p>
        )}
        <button
          onClick={onClose}
          className="mt-4 text-sm underline text-[var(--color-primary-600)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
