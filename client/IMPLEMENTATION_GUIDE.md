# Implementation Guide: Adding Transaction Feedback to Existing Components

This guide shows how to integrate the TransactionFeedback system into existing components like `EscrowTransaction`, `BarterOfferForm`, and custom transaction handlers.

## Step 1: Update Root Layout

Add the provider to your root layout:

**File:** `src/app/layout.tsx`

```tsx
import { TransactionFeedbackProvider } from "@/context/TransactionFeedbackContext";
import { WalletProviderWrapper } from "@/components/WalletProviderWrapper";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html>
      <body>
        <TransactionFeedbackProvider>
          <WalletProviderWrapper>
            {children}
          </WalletProviderWrapper>
        </TransactionFeedbackProvider>
      </body>
    </html>
  );
}
```

## Step 2: Refactor Existing Components

### Option A: Replace Manual State with Hook

**Before:**
```tsx
interface TransactionStatus {
  status: "idle" | "pending" | "confirming" | "success" | "error";
  message?: string;
  txHash?: string;
}

const [transactionStatus, setTransactionStatus] = useState<TransactionStatus>({
  status: "idle",
});

// Then manually update:
setTransactionStatus({ status: "pending", message: "Building..." });
setTransactionStatus({ status: "success", txHash: hash });
```

**After:**
```tsx
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";

const { pending, confirming, success, failure, reset } = useTransactionFeedback();
const [feedbackOpen, setFeedbackOpen] = useState(false);

// Use the methods:
pending("Building...");
confirming("Waiting...");
success(txHash);
failure("Error message");
```

### Option B: Complete Component Refactor (EscrowTransaction Example)

**File:** `src/components/EscrowTransaction.tsx`

```tsx
"use client";

import React, { useState, useContext } from "react";
import {
  Container,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Text,
  Input,
} from "@/components/ui";
import { WalletContext } from "@/context/WalletContext";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { TransactionFeedbackPanel } from "@/components/TransactionFeedbackPanel";
import { mapBlockchainError } from "@/components/errorHandler";
import { createOrder } from "@/services/stellar/contractService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";

interface EscrowTransactionProps {
  farmerAddress: string;
  tokenAddress: string;
  pricePerUnit: number;
  productName: string;
  onSuccess?: (txHash: string) => void;
}

const STELLAR_TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

export default function EscrowTransaction({
  farmerAddress,
  tokenAddress,
  pricePerUnit,
  productName,
  onSuccess,
}: EscrowTransactionProps) {
  const { address, connected } = useContext(WalletContext);
  const { pending, confirming, success, failure, reset, isLoading } =
    useTransactionFeedback();

  const [quantity, setQuantity] = useState<string>("1");
  const [deliveryDeadline, setDeliveryDeadline] = useState<string>("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const totalPrice = parseFloat(quantity || "0") * pricePerUnit;
  const totalAmount = BigInt(Math.floor(totalPrice * 10_000_000));

  const validateForm = (): boolean => {
    const errors = {
      farmerAddress: "Farmer address is missing",
      tokenAddress: "Token contract address is missing",
      quantity: "Please enter a valid quantity",
      deadline: "Please select a delivery deadline",
      pastDeadline: "Delivery deadline must be in the future",
    };

    if (!farmerAddress) {
      failure(errors.farmerAddress);
      return false;
    }
    if (!tokenAddress) {
      failure(errors.tokenAddress);
      return false;
    }
    if (!quantity || parseFloat(quantity) <= 0) {
      failure(errors.quantity);
      return false;
    }
    if (!deliveryDeadline) {
      failure(errors.deadline);
      return false;
    }
    if (new Date(deliveryDeadline) <= new Date()) {
      failure(errors.pastDeadline);
      return false;
    }

    return true;
  };

  const handleCreateOrder = async () => {
    if (!validateForm()) {
      setFeedbackOpen(true);
      return;
    }

    setFeedbackOpen(true);
    pending("Building escrow order transaction...");

    try {
      if (!connected || !address) {
        throw new Error("Please connect your wallet first");
      }

      // Step 1: Build unsigned XDR
      const unsignedXdr = await createOrder(
        address,
        farmerAddress,
        tokenAddress,
        totalAmount,
        deliveryDeadline
      );

      if (!unsignedXdr.success || !unsignedXdr.data) {
        throw new Error(
          unsignedXdr.error || "Failed to build escrow transaction"
        );
      }

      // Step 2: Sign and submit
      confirming("Please confirm the transaction in your wallet...");

      const signed = await signAndSubmitTransaction(unsignedXdr.data);
      if (!signed.success || !signed.txHash) {
        throw new Error(signed.error || "Transaction failed");
      }

      // Step 3: Success
      success(signed.txHash);

      // Optional callback
      onSuccess?.(signed.txHash);

      // Reset form
      setQuantity("1");
      setDeliveryDeadline("");
    } catch (error) {
      console.error("Transaction error:", error);
      const errorInfo = mapBlockchainError(error);
      failure(`${errorInfo.title}: ${errorInfo.message}`);
    }
  };

  if (!connected) {
    return (
      <Container size="md" className="py-8">
        <Card variant="elevated" padding="lg">
          <CardContent className="text-center py-8">
            <Text variant="h3" as="h3" className="mb-4">
              Connect Wallet Required
            </Text>
            <Text variant="body" muted>
              Please connect your wallet to create an escrow transaction.
            </Text>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" className="py-8">
      {/* Feedback Panel */}
      <TransactionFeedbackPanel
        variant="inline"
        isOpen={feedbackOpen}
        onClose={() => {
          setFeedbackOpen(false);
          reset();
        }}
        getTxUrl={(hash) => `${STELLAR_TESTNET_EXPLORER}${hash}`}
        showCopyButton
        showExplorerLink
      />

      {/* Form (hidden while feedback open) */}
      {!feedbackOpen && (
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <CardTitle>Create Escrow Order</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Product
                </label>
                <Input value={productName} disabled />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Price per Unit
                </label>
                <Input value={`$${pricePerUnit.toFixed(2)}`} disabled />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Quantity
                </label>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Enter quantity"
                  min="1"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Delivery Deadline
                </label>
                <Input
                  type="datetime-local"
                  value={deliveryDeadline}
                  onChange={(e) => setDeliveryDeadline(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="bg-muted/50 p-3 rounded-lg">
              <Text variant="bodySmall" muted>
                Total Amount:
              </Text>
              <Text variant="h3">${totalPrice.toFixed(2)}</Text>
            </div>
          </CardContent>

          <CardFooter>
            <Button
              onClick={handleCreateOrder}
              isLoading={isLoading}
              fullWidth
              size="lg"
              disabled={isLoading}
            >
              {isLoading ? "Processing..." : "Create Escrow Order"}
            </Button>
          </CardFooter>
        </Card>
      )}
    </Container>
  );
}
```

## Step 3: Add Toast Integration (Optional but Recommended)

Add this to your root page or layout:

```tsx
import { TransactionFeedbackToast } from "@/components/TransactionFeedbackToast";
import { Toaster } from "sonner";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <TransactionFeedbackToast
          getTxUrl={(hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`}
          showExplorerLink
          successDismissMs={5000}
          errorDismissMs={8000}
        />
        <Toaster />
        {children}
      </body>
    </html>
  );
}
```

## Step 4: Refactor Other Transaction Components

Apply the same pattern to:

- `BarterOfferForm.tsx`
- `ProductFormModal.tsx`
- Any other component with transaction flows

### Generic Pattern

```tsx
"use client";

import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { TransactionFeedbackPanel } from "@/components/TransactionFeedbackPanel";
import { useState } from "react";

export default function MyTransactionComponent() {
  const { pending, confirming, success, failure, reset } =
    useTransactionFeedback();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const handleTransaction = async () => {
    setFeedbackOpen(true);
    try {
      pending("Step 1...");
      // ... work
      confirming("Step 2...");
      // ... work
      success(txHash);
    } catch (err) {
      failure(err.message);
    }
  };

  return (
    <>
      <button onClick={handleTransaction}>Submit</button>

      <TransactionFeedbackPanel
        isOpen={feedbackOpen}
        onClose={() => {
          reset();
          setFeedbackOpen(false);
        }}
        variant="inline" // or "modal"
      />
    </>
  );
}
```

## Migration Checklist

- [ ] Add `TransactionFeedbackProvider` to root layout
- [ ] (Optional) Add `TransactionFeedbackToast` to root page
- [ ] Update `EscrowTransaction.tsx`
- [ ] Update `BarterOfferForm.tsx`
- [ ] Update `ProductFormModal.tsx`
- [ ] Remove manual `transactionStatus` state from components
- [ ] Test each component individually
- [ ] Test full transaction flows
- [ ] Verify block explorer links work
- [ ] Test on mobile (responsive feedback UI)

## Troubleshooting Common Issues

### Issue: "Hook must be used within provider"
**Solution:** Ensure `TransactionFeedbackProvider` wraps your component tree in the layout.

### Issue: Feedback not dismissing
**Solution:** Call `reset()` in your `onClose` handler.

### Issue: Multiple feedback panels showing
**Solution:** Use global state - the context is singleton. Only one feedback state exists.

### Issue: Toast not showing
**Solution:** Ensure `TransactionFeedbackToast` is rendered in your app, and `Toaster` from Sonrer is included.

## Advanced: Custom Styling

Override Tailwind classes in `TransactionFeedbackPanel`:

```tsx
<TransactionFeedbackPanel
  variant="modal"
  isOpen={open}
  className="custom-feedback" // Add custom class
/>
```

Then in your CSS:

```css
.custom-feedback {
  /* Custom styles */
}
```

## Next: Testing

See [Testing Guide](TESTING.md) for unit and integration tests.
