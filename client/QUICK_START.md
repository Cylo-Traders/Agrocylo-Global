# Quick Start

## Prerequisites
- Node.js 20+
- npm 10+
- Freighter wallet browser extension
- Backend server running on port 5000

## Installation
```bash
cd client
npm install
cp .env.example .env.local
npm run dev
```

## Key Libraries

| Library | Purpose |
|---|---|
| Next.js 16 | React framework |
| TanStack Query | Server state & caching |
| Zustand | Client state (minimal usage) |
| Zod | Schema validation |
| react-hook-form | Form state management |
| Sonner | Toast notifications |
| Stellar SDK | Blockchain interaction |

## Project Structure
```
src/
  app/          Next.js App Router pages & layouts
  components/   Reusable React components
    ui/         Primitive UI components (Radix-based)
    shared/     Shared app components
    modals/     Modal components
    orders/     Order-related components
    providers/  React context providers
  context/      React context definitions
  hooks/        Custom React hooks
  lib/          Utilities, API config, validation schemas
  services/     Backend API service functions
  types/        TypeScript type definitions
```

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
