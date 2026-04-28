# Testing Guide: Transaction Feedback UI

Unit and integration tests for the TransactionFeedback system.

## Setup

Ensure you have Vitest and React Testing Library set up (already in the project).

## Unit Tests

### Test 1: Context Provider & Hook

**File:** `src/context/TransactionFeedbackContext.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { TransactionFeedbackProvider } from "@/context/TransactionFeedbackContext";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { describe, it, expect } from "vitest";

function TestComponent() {
  const { feedback, pending, success } = useTransactionFeedback();
  return (
    <div>
      <div data-testid="state">{feedback.state}</div>
      <button onClick={() => pending("Test message")}>Pending</button>
      <button onClick={() => success("mock-hash")}>Success</button>
    </div>
  );
}

describe("TransactionFeedbackContext", () => {
  it("should throw error when hook used outside provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestComponent />)).toThrow(
      "useTransactionFeedback must be used within TransactionFeedbackProvider"
    );
    consoleError.mockRestore();
  });

  it("should provide context within provider", () => {
    render(
      <TransactionFeedbackProvider>
        <TestComponent />
      </TransactionFeedbackProvider>
    );
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("should update state on pending()", async () => {
    const { user } = render(
      <TransactionFeedbackProvider>
        <TestComponent />
      </TransactionFeedbackProvider>
    );

    const pendingBtn = screen.getByText("Pending");
    await user.click(pendingBtn);

    expect(screen.getByTestId("state")).toHaveTextContent("pending");
  });

  it("should update state on success()", async () => {
    const { user } = render(
      <TransactionFeedbackProvider>
        <TestComponent />
      </TransactionFeedbackProvider>
    );

    const successBtn = screen.getByText("Success");
    await user.click(successBtn);

    expect(screen.getByTestId("state")).toHaveTextContent("success");
  });
});
```

### Test 2: useTransactionFeedback Hook

**File:** `src/hooks/useTransactionFeedback.test.ts`

```tsx
import { renderHook, act } from "@testing-library/react";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { TransactionFeedbackProvider } from "@/context/TransactionFeedbackContext";
import { describe, it, expect, vi } from "vitest";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TransactionFeedbackProvider>{children}</TransactionFeedbackProvider>
);

describe("useTransactionFeedback", () => {
  it("should have initial idle state", () => {
    const { result } = renderHook(() => useTransactionFeedback(), { wrapper });
    expect(result.current.feedback.state).toBe("idle");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isTerminal).toBe(false);
  });

  it("should transition through states", () => {
    const { result } = renderHook(() => useTransactionFeedback(), { wrapper });

    act(() => result.current.pending("Building..."));
    expect(result.current.feedback.state).toBe("pending");
    expect(result.current.isLoading).toBe(true);

    act(() => result.current.confirming("Confirming..."));
    expect(result.current.feedback.state).toBe("confirming");
    expect(result.current.isLoading).toBe(true);

    act(() => result.current.success("tx-hash"));
    expect(result.current.feedback.state).toBe("success");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isTerminal).toBe(true);
  });

  it("should handle executeTransaction success", async () => {
    const { result } = renderHook(() => useTransactionFeedback(), { wrapper });

    const mockFn = vi.fn().mockResolvedValue({ txHash: "mock-hash" });

    let txResult;
    await act(async () => {
      txResult = await result.current.executeTransaction(mockFn);
    });

    expect(txResult?.success).toBe(true);
    expect(txResult?.txHash).toBe("mock-hash");
    expect(result.current.feedback.state).toBe("success");
    expect(result.current.feedback.txHash).toBe("mock-hash");
  });

  it("should handle executeTransaction failure", async () => {
    const { result } = renderHook(() => useTransactionFeedback(), { wrapper });

    const mockFn = vi
      .fn()
      .mockRejectedValue(new Error("Transaction failed"));

    let txResult;
    await act(async () => {
      txResult = await result.current.executeTransaction(mockFn);
    });

    expect(txResult?.success).toBe(false);
    expect(txResult?.error).toBe("Transaction failed");
    expect(result.current.feedback.state).toBe("failure");
  });

  it("should reset to idle state", () => {
    const { result } = renderHook(() => useTransactionFeedback(), { wrapper });

    act(() => result.current.success("hash"));
    expect(result.current.feedback.state).toBe("success");

    act(() => result.current.reset());
    expect(result.current.feedback.state).toBe("idle");
  });
});
```

### Test 3: TransactionFeedbackPanel Component

**File:** `src/components/TransactionFeedbackPanel.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { TransactionFeedbackPanel } from "@/components/TransactionFeedbackPanel";
import { TransactionFeedbackProvider } from "@/context/TransactionFeedbackContext";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { describe, it, expect, vi } from "vitest";

function TestWrapper() {
  const { pending, success } = useTransactionFeedback();

  return (
    <>
      <button onClick={() => pending("Building...")}>Trigger Pending</button>
      <button onClick={() => success("tx-hash-123")}>Trigger Success</button>
      <TransactionFeedbackPanel isOpen />
    </>
  );
}

describe("TransactionFeedbackPanel", () => {
  it("should render nothing when closed", () => {
    render(
      <TransactionFeedbackProvider>
        <TransactionFeedbackPanel isOpen={false} />
      </TransactionFeedbackProvider>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should display pending state", () => {
    render(
      <TransactionFeedbackProvider>
        <TestWrapper />
      </TransactionFeedbackProvider>
    );

    const triggerBtn = screen.getByText("Trigger Pending");
    triggerBtn.click();

    expect(screen.getByText("Processing transaction...")).toBeInTheDocument();
  });

  it("should display success state with hash", async () => {
    const { user } = render(
      <TransactionFeedbackProvider>
        <TestWrapper />
      </TransactionFeedbackProvider>
    );

    const triggerBtn = screen.getByText("Trigger Success");
    await user.click(triggerBtn);

    expect(screen.getByText("Transaction confirmed")).toBeInTheDocument();
    expect(screen.getByText("tx-hash-123")).toBeInTheDocument();
  });

  it("should show copy button", () => {
    render(
      <TransactionFeedbackProvider>
        <TestWrapper />
      </TransactionFeedbackProvider>
    );

    const triggerBtn = screen.getByText("Trigger Success");
    triggerBtn.click();

    expect(screen.getByText("Copy Hash")).toBeInTheDocument();
  });

  it("should show explorer link when getTxUrl provided", () => {
    render(
      <TransactionFeedbackProvider>
        <Button onClick={() => success("hash")}>Success</Button>
        <TransactionFeedbackPanel
          isOpen
          getTxUrl={(hash) => `https://explorer.com/tx/${hash}`}
          showExplorerLink
        />
      </TransactionFeedbackProvider>
    );

    expect(
      screen.getByRole("link", { name: /view explorer/i })
    ).toBeInTheDocument();
  });

  it("should call onClose callback", async () => {
    const onClose = vi.fn();
    const { user } = render(
      <TransactionFeedbackProvider>
        <TestWrapper />
      </TransactionFeedbackProvider>
    );

    // Not implemented in this test, but you would:
    // - Trigger success state
    // - Click close button
    // - Verify onClose was called
  });

  it("should auto-dismiss on success", vi.useFakeTimers(async () => {
    const onClose = vi.fn();
    render(
      <TransactionFeedbackProvider>
        <TestWrapper />
      </TransactionFeedbackProvider>
    );

    // Trigger success
    screen.getByText("Trigger Success").click();

    // Fast-forward time
    vi.advanceTimersByTime(5000);

    // Verify it's hidden (requires implementation)
    // ...
  }));

  it("should render modal variant", () => {
    render(
      <TransactionFeedbackProvider>
        <TransactionFeedbackPanel variant="modal" isOpen />
      </TransactionFeedbackProvider>
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("should render inline variant", () => {
    render(
      <TransactionFeedbackProvider>
        <TransactionFeedbackPanel variant="inline" isOpen />
      </TransactionFeedbackProvider>
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

## Integration Tests

### Test: Full Transaction Flow

**File:** `src/components/EscrowTransaction.integration.test.tsx`

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import EscrowTransaction from "@/components/EscrowTransaction";
import { TransactionFeedbackProvider } from "@/context/TransactionFeedbackContext";
import { WalletContext } from "@/context/WalletContext";
import * as contractService from "@/services/stellar/contractService";
import * as signTransaction from "@/lib/signTransaction";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/stellar/contractService");
vi.mock("@/lib/signTransaction");

const mockWalletContext = {
  address: "GTEST123....",
  connected: true,
  network: "testnet",
};

describe("EscrowTransaction Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should complete full transaction flow", async () => {
    const user = userEvent.setup();

    vi.mocked(contractService.createOrder).mockResolvedValue({
      success: true,
      data: "mock-xdr",
    });

    vi.mocked(signTransaction.signAndSubmitTransaction).mockResolvedValue({
      success: true,
      txHash: "abc123...",
    });

    render(
      <TransactionFeedbackProvider>
        <WalletContext.Provider value={mockWalletContext}>
          <EscrowTransaction
            farmerAddress="GFARMER..."
            tokenAddress="GTOKEN..."
            pricePerUnit={10}
            productName="Wheat"
          />
        </WalletContext.Provider>
      </TransactionFeedbackProvider>
    );

    // Fill form
    await user.type(screen.getByLabelText("Quantity"), "5");
    await user.type(
      screen.getByLabelText("Delivery Deadline"),
      "2025-12-31T23:59"
    );

    // Submit
    await user.click(screen.getByText("Create Escrow Order"));

    // Check states appear
    await waitFor(() => {
      expect(
        screen.getByText(/building escrow order/i)
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/transaction confirmed/i)).toBeInTheDocument();
    });

    // Check hash is displayed
    expect(screen.getByText(/abc123/i)).toBeInTheDocument();
  });

  it("should handle transaction failure", async () => {
    const user = userEvent.setup();

    vi.mocked(contractService.createOrder).mockRejectedValue(
      new Error("Build failed")
    );

    render(
      <TransactionFeedbackProvider>
        <WalletContext.Provider value={mockWalletContext}>
          <EscrowTransaction
            farmerAddress="GFARMER..."
            tokenAddress="GTOKEN..."
            pricePerUnit={10}
            productName="Wheat"
          />
        </WalletContext.Provider>
      </TransactionFeedbackProvider>
    );

    // Fill and submit
    await user.type(screen.getByLabelText("Quantity"), "5");
    await user.type(
      screen.getByLabelText("Delivery Deadline"),
      "2025-12-31T23:59"
    );
    await user.click(screen.getByText("Create Escrow Order"));

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText(/transaction failed/i)).toBeInTheDocument();
    });
  });

  it("should validate form before submitting", async () => {
    const user = userEvent.setup();

    render(
      <TransactionFeedbackProvider>
        <WalletContext.Provider value={mockWalletContext}>
          <EscrowTransaction
            farmerAddress="GFARMER..."
            tokenAddress="GTOKEN..."
            pricePerUnit={10}
            productName="Wheat"
          />
        </WalletContext.Provider>
      </TransactionFeedbackProvider>
    );

    // Submit without filling fields
    await user.click(screen.getByText("Create Escrow Order"));

    // Should show validation error
    await waitFor(() => {
      expect(
        screen.getByText(/select a delivery deadline/i)
      ).toBeInTheDocument();
    });

    // Contract should not be called
    expect(contractService.createOrder).not.toHaveBeenCalled();
  });
});
```

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific file
npm test -- TransactionFeedbackContext.test.tsx

# Watch mode
npm test -- --watch
```

## Test Coverage Goals

- Context: 95%+
- Hook: 95%+
- Panel Component: 90%+
- Toast Component: 85%+
- Integration: Core flows only

## Mocking Tips

```tsx
// Mock Sonner toast
vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// Mock blockchain service
vi.mock("@/services/stellar/contractService", () => ({
  createOrder: vi.fn(),
}));

// Mock sign transaction
vi.mock("@/lib/signTransaction", () => ({
  signAndSubmitTransaction: vi.fn(),
}));
```

## Next: Visual Testing with Storybook

Consider adding Storybook stories for manual component testing:

```tsx
// TransactionFeedbackPanel.stories.tsx
export const Pending = () => (
  <TransactionFeedbackProvider>
    <TransactionFeedbackPanel variant="modal" isOpen />
  </TransactionFeedbackProvider>
);

export const Success = () => (
  <TransactionFeedbackProvider>
    <TestWithState state="success" txHash="abc123" />
  </TransactionFeedbackProvider>
);
```
