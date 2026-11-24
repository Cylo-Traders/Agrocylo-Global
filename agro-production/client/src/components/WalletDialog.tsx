import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import type { WalletAdapter } from '../types/wallet';

interface WalletDialogProps {
  open: boolean;
  onClose: () => void;
}

export function WalletDialog({ open, onClose }: WalletDialogProps) {
  const { connect, connecting, error } = useWallet();
  const [selected, setSelected] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      inFlightRef.current = false;
    }
  }, [open]);

  const handleSelect = useCallback(
    async (adapter: WalletAdapter) => {
      if (inFlightRef.current || connecting) {
        return;
      }
      inFlightRef.current = true;
      setSelected(adapter.id);
      try {
        await connect(adapter);
        onClose();
      } catch {
        // Errors are surfaced through the wallet context.
      } finally {
        inFlightRef.current = false;
        setSelected(null);
      }
    },
    [connect, connecting, onClose],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="wallet-dialog" role="dialog" aria-modal="true">
      <div className="wallet-dialog__header">
        <h2>Connect Wallet</h2>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <ul className="wallet-dialog__list">
        {adapters.map((adapter) => {
          const isBusy = connecting && selected === adapter.id;
          return (
            <li key={adapter.id}>
              <button
                type="button"
                disabled={connecting}
                onClick={() => handleSelect(adapter)}
              >
                {adapter.name}
                {isBusy ? ' — connecting…' : ''}
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p className="wallet-dialog__error">{error}</p> : null}
    </div>
  );
}
