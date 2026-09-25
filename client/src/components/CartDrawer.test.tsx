import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CartDrawer from './CartDrawer';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock the hooks used in the component
const mockRefreshCart = vi.fn();
const mockSetDrawerOpen = vi.fn();
const mockGetConfirmedCart = vi.fn(() => Promise.resolve(null));

vi.mock('@/context/CartContext', () => ({
  useCart: () => ({
    cart: {
      cart_id: 'cart_1',
      groups: [
        {
          farmer_wallet: 'FARMER_1',
          farmer_name: 'Green Farm',
          currency: 'USDC',
          subtotal: '10000000',
          items: [
            {
              id: 'item_1',
              product_id: 'p1',
              name: 'Organic Wheat',
              quantity: '10',
              unit_price: '1000000',
              unit: 'kg'
            }
          ]
        }
      ]
    },
    itemCount: 1,
    cartLoading: false,
    cartError: null,
    drawerOpen: true,
    setDrawerOpen: mockSetDrawerOpen,
    refreshCart: mockRefreshCart,
    setQuantityForProduct: vi.fn(),
    removeCartItem: vi.fn(),
    hasPendingUpdates: false,
    pendingCount: 0,
    flushPendingUpdates: vi.fn(() => Promise.resolve()),
    getConfirmedCart: mockGetConfirmedCart,
  }),
}));

vi.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    address: 'GD...USER',
    connected: true,
    signAndSubmit: vi.fn(),
  }),
}));

describe('CartDrawer Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders cart groups and calculates totals', () => {
    render(<CartDrawer />);

    // Check farmer name and product name
    expect(screen.getByText('Green Farm')).toBeInTheDocument();
    expect(screen.getByText('Organic Wheat')).toBeInTheDocument();

    // Verify calculations with formatted minor units (7 decimals)
    // 10,000,000 base = 1 USDC, fee 300,000 = 0.03, net 9,700,000 = 0.97
    expect(screen.getByText('1 USDC')).toBeInTheDocument();
    expect(screen.getByText('0.03 USDC')).toBeInTheDocument();
    expect(screen.getByText('0.97 USDC')).toBeInTheDocument();
  });

  it('progresses through checkout steps', async () => {
    render(<CartDrawer />);

    // Step 1 -> Step 2
    const proceedBtn = screen.getByText('Proceed to Checkout');
    fireEvent.click(proceedBtn);

    expect(screen.getByText('Per-farmer escrow')).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery deadline/i)).toBeInTheDocument();
  });

  it('closes and resets when clicking continue shopping', () => {
    render(<CartDrawer />);

    const closeBtn = screen.getByText('Continue shopping');
    fireEvent.click(closeBtn);

    expect(mockSetDrawerOpen).toHaveBeenCalledWith(false);
  });
});