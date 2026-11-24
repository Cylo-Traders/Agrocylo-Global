import { useState, useEffect, useCallback } from 'react';
import { useCart } from '../hooks/useCart';
import { useToast } from '../hooks/useToast';

interface CartControlsProps {
  productId: string;
  initialQuantity?: number;
  stockQuantity?: number | null;
  unit?: string;
  onQuantityChange?: (quantity: number) => void;
}

interface StockAdjustment {
  requested: number;
  available: number;
}

export default function CartControls({
  productId,
  initialQuantity = 1,
  stockQuantity = null,
  unit = 'unit',
  onQuantityChange,
}: CartControlsProps) {
  const { addItem, updateItem } = useCart();
  const { showToast } = useToast();
  const [quantity, setQuantity] = useState(initialQuantity);
  const [adjustment, setAdjustment] = useState<StockAdjustment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hasKnownStock = typeof stockQuantity === 'number' && stockQuantity >= 0;
  const maxQuantity = hasKnownStock ? stockQuantity : Infinity;
  const isOutOfStock = hasKnownStock && stockQuantity === 0;

  useEffect(() => {
    setQuantity(initialQuantity);
  }, [initialQuantity]);

  const applyServerQuantity = useCallback(
    (serverQuantity: number, requested: number) => {
      setQuantity(serverQuantity);
      onQuantityChange?.(serverQuantity);
      if (serverQuantity !== requested) {
        setAdjustment({ requested, available: serverQuantity });
        showToast(
          `Only ${serverQuantity} ${unit}${serverQuantity === 1 ? '' : 's'} available. Your cart was adjusted.`,
          'warning'
        );
      } else {
        setAdjustment(null);
      }
    },
    [onQuantityChange, showToast, unit]
  );

  const handleIncrement = () => {
    if (quantity >= maxQuantity) {
      if (hasKnownStock) {
        showToast(
          `Maximum available stock is ${stockQuantity} ${unit}${stockQuantity === 1 ? '' : 's'}.`,
          'info'
        );
      }
      return;
    }
    const next = quantity + 1;
    setQuantity(next);
    setAdjustment(null);
    onQuantityChange?.(next);
  };

  const handleDecrement = () => {
    if (quantity <= 1) return;
    const next = quantity - 1;
    setQuantity(next);
    setAdjustment(null);
    onQuantityChange?.(next);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(event.target.value, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(1, Math.min(parsed, maxQuantity));
    setQuantity(clamped);
    setAdjustment(null);
    onQuantityChange?.(clamped);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const result = await updateItem(productId, quantity);
      const serverQuantity =
        typeof result?.quantity === 'number' ? result.quantity : quantity;
      applyServerQuantity(serverQuantity, quantity);
    } catch (error) {
      const serverQuantity = (error as { availableQuantity?: number })
        ?.availableQuantity;
      if (typeof serverQuantity === 'number') {
        applyServerQuantity(serverQuantity, quantity);
      } else {
        showToast('Could not update cart quantity. Please try again.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddToCart = async () => {
    setIsSubmitting(true);
    try {
      const result = await addItem(productId, quantity);
      const serverQuantity =
        typeof result?.quantity === 'number' ? result.quantity : quantity;
      applyServerQuantity(serverQuantity, quantity);
    } catch (error) {
      const serverQuantity = (error as { availableQuantity?: number })
        ?.availableQuantity;
      if (typeof serverQuantity === 'number') {
        applyServerQuantity(serverQuantity, quantity);
      } else {
        showToast('Could not add item to cart. Please try again.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cart-controls">
      <div className="cart-controls__quantity">
        <button
          type="button"
          className="cart-controls__button"
          onClick={handleDecrement}
          disabled={quantity <= 1 || isSubmitting}
          aria-label="Decrease quantity"
        >
          -
        </button>
        <input
          type="number"
          className="cart-controls__input"
          value={quantity}
          min={1}
          max={hasKnownStock ? stockQuantity : undefined}
          onChange={handleChange}
          disabled={isSubmitting || isOutOfStock}
          aria-label={`Quantity in ${unit}s`}
        />
        <span className="cart-controls__unit" aria-hidden="true">
          {unit}
          {quantity === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="cart-controls__button"
          onClick={handleIncrement}
          disabled={quantity >= maxQuantity || isSubmitting || isOutOfStock}
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>

      {hasKnownStock && (
        <p className="cart-controls__stock">
          {isOutOfStock
            ? 'Out of stock'
            : `${stockQuantity} ${unit}${stockQuantity === 1 ? '' : 's'} available`}
        </p>
      )}

      {adjustment && (
        <p className="cart-controls__adjustment" role="status">
          Quantity adjusted from {adjustment.requested} to {adjustment.available}{' '}
          {unit}
          {adjustment.available === 1 ? '' : 's'} due to available stock.
        </p>
      )}

      <button
        type="button"
        className="cart-controls__submit"
        onClick={handleAddToCart}
        disabled={isSubmitting || isOutOfStock}
      >
        {isOutOfStock ? 'Out of stock' : 'Add to cart'}
      </button>

      <button
        type="button"
        className="cart-controls__submit cart-controls__submit--secondary"
        onClick={handleSubmit}
        disabled={isSubmitting || isOutOfStock}
      >
        Update cart
      </button>
    </div>
  );
}
