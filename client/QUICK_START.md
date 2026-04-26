# Quick Start: Transaction Feedback UI

Get up and running in 5 minutes.

## 1. Add Provider to Root Layout

```tsx
// src/app/layout.tsx
import { TransactionFeedbackProvider } from "@/context/TransactionFeedbackContext";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <TransactionFeedbackProvider>
          {children}
        </TransactionFeedbackProvider>
      </body>
    </html>
  );
}
```

## 2. Use the Hook in Your Component

```tsx
"use client";

import { useState } from "react";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { TransactionFeedbackPanel } from "@/components/TransactionFeedbackPanel";
import { Button } from "@/components/ui/Button";

export default function MyTransaction() {
  const { pending, success, failure, reset } = useTransactionFeedback();
  const [open, setOpen] = useState(false);

  const handleSubmit = async () => {
    setOpen(true);
    try {
      pending("Processing...");
      // Do your transaction work
      const result = await submitTransaction();
      success(result.txHash);
    } catch (err) {
      failure(err.message);
    }
  };

  return (
    <>
      <Button onClick={handleSubmit}>Submit</Button>

      <TransactionFeedbackPanel
        isOpen={open}
        onClose={() => {
          reset();
          setOpen(false);
        }}
      />
    </>
  );
}
```

## 3. (Optional) Add Toast Notifications

Add this once in your root layout or app wrapper:

```tsx
import { TransactionFeedbackToast } from "@/components/TransactionFeedbackToast";

export default function App() {
  return (
    <>
      <TransactionFeedbackToast />
      {/* rest of app */}
    </>
  );
}
```

Now toasts will automatically show transaction status!

## Key Methods

- `pending(msg)` — Show loading state
- `confirming(msg)` — Show confirmation state
- `success(txHash)` — Show success (accepts hash)
- `failure(errorMsg)` — Show error
- `reset()` — Clear feedback

## Done! 🎉

Your transaction feedback UI is ready. See [TRANSACTION_FEEDBACK_GUIDE.md](TRANSACTION_FEEDBACK_GUIDE.md) for advanced usage.
