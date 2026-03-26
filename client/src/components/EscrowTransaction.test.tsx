import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EscrowTransaction from './EscrowTransaction';
import { WalletContext } from '@/context/WalletContext';

// Mocking external services and hooks to isolate component logic
vi.mock('@/services/stellar/contractService', () => ({
  createOrder: vi.fn(),
}));
vi.mock('@/lib/signTransaction', () => ({
  signAndSubmitTransaction: vi.fn(),
}));
vi.mock('@/services/notification', () => ({
  notifyTransactionSubmitted: vi.fn(),
  notifyTransactionConfirmed: vi.fn(),
  notifyTransactionFailed: vi.fn(),
  notifyTransactionConfirming: vi.fn(),
}));

const mockContextValue = {
  address: 'GD5DJQJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2',
  connected: true,
  network: 'TESTNET',
};

describe('EscrowTransaction Component', () => {
  const defaultProps = {
    farmerAddress: 'FARMER_ADDR',
    tokenAddress: 'TOKEN_ADDR',
    pricePerUnit: 10.5,
    productName: 'Organic Tomatoes',
  };

  it('renders product details and calculates total price correctly', () => {
    render(
      <WalletContext.Provider value={mockContextValue as any}>
        <EscrowTransaction {...defaultProps} />
      </WalletContext.Provider>
    );

    expect(screen.getByText('Organic Tomatoes')).toBeInTheDocument();
    expect(screen.getByText('10.5 XLM')).toBeInTheDocument();
    
    const quantityInput = screen.getByLabelText(/Quantity/i);
    fireEvent.change(quantityInput, { target: { value: '2' } });
    
    // 2 * 10.5 = 21.00
    expect(screen.getByText('21.00 XLM')).toBeInTheDocument();
  });

  it('validates that delivery deadline is required before submission', async () => {
    render(
      <WalletContext.Provider value={mockContextValue as any}>
        <EscrowTransaction {...defaultProps} />
      </WalletContext.Provider>
    );

    const submitBtn = screen.getByText('Create Escrow Order');
    fireEvent.click(submitBtn);

    expect(await screen.findByText('Please select a delivery deadline')).toBeInTheDocument();
  });
});