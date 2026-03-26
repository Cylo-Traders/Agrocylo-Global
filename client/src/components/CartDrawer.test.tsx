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

vi.mock('@/context/CartContext', () => ({
  useCart: () => ({
    cart: {
      groups: [
        {
          farmer_wallet: 'FARMER_1',
          farmer_name: 'Green Farm',
          currency: 'USDC',
          subtotal: '1000',
          items: [
            {
              id: 'item_1',
              product_id: 'p1',
              name: 'Organic Wheat',
              quantity: '10',
              unit_price: '100',
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

    // Verify calculations (Gross 1000, Fee 3% = 30, Net = 970)
    expect(screen.getAllByText('1000')).toHaveLength(2); // Group subtotal and Total Gross
    expect(screen.getAllByText('30')).toHaveLength(2);   // Group fee and Total Fee
    expect(screen.getAllByText('970')).toHaveLength(2);  // Group net and Total Net
  });

  it('progresses through checkout steps', async () => {
    render(<CartDrawer />);

    // Step 1 -> Step 2
    const proceedBtn = screen.getByText('Proceed to Checkout');
    fireEvent.click(proceedBtn);

    expect(screen.getByText('Confirm Orders')).toBeInTheDocument();
    expect(screen.getByLabelText(/Delivery deadline/i)).toBeInTheDocument();
  });

  it('closes and resets when clicking the close button', () => {
    render(<CartDrawer />);

    const closeBtn = screen.getByText('Close');
    fireEvent.click(closeBtn);

    expect(mockSetDrawerOpen).toHaveBeenCalledWith(false);
  });
});