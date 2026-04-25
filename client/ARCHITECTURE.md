# Transaction Feedback Architecture & Data Flow

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         App Root (layout.tsx)                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ TransactionFeedbackProvider                                  │  │
│  │  (Manages global transaction state)                          │  │
│  │                                                               │  │
│  │  Context:                                                    │  │
│  │  • feedback: TransactionFeedback                            │  │
│  │  • Methods: pending(), confirming(), success(), etc.        │  │
│  └───────────────┬───────────────────────────────────────────┘  │
│                  │                                                │
│  ┌───────────────┴───────────────────────────────────────────┐  │
│  │            All App Components (children)                   │  │
│  │                                                             │  │
│  │ ┌─────────────────────────────────────────────────────┐  │  │
│  │ │ Component A (uses useTransactionFeedback hook)      │  │  │
│  │ │ • pending() → starts loading                        │  │  │
│  │ │ • success(hash) → shows success                     │  │  │
│  │ │ • failure(err) → shows error                        │  │  │
│  │ └─────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │ ┌─────────────────────────────────────────────────────┐  │  │
│  │ │ TransactionFeedbackPanel (inline/modal UI)         │  │  │
│  │ │ • Reads context state                              │  │  │
│  │ │ • Renders spinner/icon conditionally               │  │  │
│  │ │ • Shows hash, copy, explorer links                 │  │  │
│  │ │ • Calls reset() on close                           │  │  │
│  │ └─────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │ ┌─────────────────────────────────────────────────────┐  │  │
│  │ │ TransactionFeedbackToast (optional)                │  │  │
│  │ │ • Watches context changes                          │  │  │
│  │ │ • Auto-displays Sonner toasts                      │  │  │
│  │ │ • Shows txHash preview                             │  │  │
│  │ └─────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow: Transaction Lifecycle

```
USER ACTION
│
├─ Button Click: "Submit Transaction"
│
├─ Component calls: pending("Building...")
│  │
│  └─→ Context updates: state='pending', message='Building...'
│      │
│      └─→ Panel re-renders: Shows spinner, message
│      └─→ Toast updates: Shows "Building..." toast
│
├─ Async work: try {
│  │
│  ├─ Component calls: confirming("Awaiting signature...")
│  │  │
│  │  └─→ Context updates: state='confirming'
│  │      │
│  │      └─→ Panel: Spinner still showing, message updated
│  │      └─→ Toast: Toast updates
│  │
│  ├─ Blockchain call succeeds
│  │  │
│  │  ├─ Component calls: success("tx-hash-abc123...")
│  │  │  │
│  │  │  └─→ Context updates: state='success', txHash='...'
│  │  │      │
│  │  │      └─→ Panel: Shows checkmark, displays hash
│  │  │      └─→ Panel: Shows copy + explorer buttons
│  │  │      └─→ Toast: Shows success with hash preview
│  │  │
│  │  └─ Auto-dismiss timer: 5s on success (configurable)
│  │     │
│  │     └─→ onClose(): reset(), setOpen(false)
│  │         │
│  │         └─→ Context: state='idle'
│  │             Panel/Toast hidden
│  │
│  └─ } catch(err) {
│      │
│      ├─ Component calls: failure("Out of balance")
│      │  │
│      │  └─→ Context updates: state='failure', errorMessage='...'
│      │      │
│      │      └─→ Panel: Shows X icon, error message
│      │      └─→ Toast: Shows error notification
│      │
│      └─ Manual dismiss: User clicks "Close"
│         │
│         └─→ onClose(): reset(), setOpen(false)
│             Context: state='idle'
│
└─ User sees: Loading → Success/Error → New transaction ready
```

## Component Communication

```
         ┌──────────────────────────────┐
         │    React Component Tree      │
         │  (e.g., EscrowTransaction)   │
         └──────────┬───────────────────┘
                    │
         ┌──────────▼────────────────┐
         │  useTransactionFeedback() │ ◄── Hook reads context
         │  Gets methods:            │
         │  • pending()              │
         │  • confirming()           │
         │  • success()              │
         │  • failure()              │
         │  • reset()                │
         └──┬───────────────────────┬┘
            │                       │
    ┌───────▼────────┐    ┌────────▼──────────┐
    │ Calls methods  │    │ Reads state via   │
    │ when needed    │    │ feedback object   │
    └───────┬────────┘    └────────┬──────────┘
            │                      │
            │                      │
    ┌───────▼──────────────────────▼──────────┐
    │  TransactionFeedbackContext (Provider)  │
    │  ┌─────────────────────────────────────┤
    │  │ State: feedback = {                 │
    │  │   state: 'pending'|'success'|...   │
    │  │   txHash?: string                  │
    │  │   errorMessage?: string            │
    │  │   message?: string                 │
    │  │   timestamp?: number               │
    │  │ }                                   │
    │  │                                     │
    │  │ Methods:                            │
    │  │ • pending(msg)                      │
    │  │ • confirming(msg)                   │
    │  │ • success(hash)                     │
    │  │ • failure(error)                    │
    │  │ • reset()                           │
    │  └─────────────────────────────────────┤
    └───┬───────────────┬───────────────────┘
        │               │
        │               │
    ┌───▼──────────┐    └───┬──────────────────┐
    │ Panel        │        │ Toast            │
    │ • Reads      │        │ • Watches state  │
    │   state      │        │ • Shows toasts   │
    │ • Shows UI   │        │ • Auto-dismiss   │
    │ • Copy btn   │        │ • Shows hash     │
    │ • Explorer   │        │ • Explorer link  │
    │   link       │        │                  │
    └──────────────┘        └──────────────────┘
```

## State Machine

```
                    ┌───────────────────┐
                    │ IDLE (initial)    │
                    │ No UI visible     │
                    └───────────────────┘
                            ▲
                            │ reset()
                            │
                 ┌──────────┴──────────┐
                 │                     │
                 │              ┌──────┴─────┐
                 │              │            │
         ┌───────▼────────┐    │      ┌──────▼─────┐
         │ PENDING        │    │      │ CONFIRMING │
         │ [Spinner]      │    │      │ [Spinner]  │
         │ pending(msg)   │    │      │ confirming()│
         │ confirming()───┼────┘      └───────┬────┘
         │ failure()──┐   │                   │
         └───────────┼───┘                    │
                     │                        │ success(hash)
                     │                        │ or failure(err)
                     │                        │
         ┌───────────▼────────────────────────▼─────┐
         │                                           │
    ┌────▼─────────────────────┐    ┌──────────────▼──┐
    │ SUCCESS                  │    │ FAILURE         │
    │ [Checkmark Icon]         │    │ [X Icon]        │
    │ Shows txHash             │    │ Shows error msg │
    │ Copy & explorer buttons  │    │ Retry option    │
    │ Auto-dismiss: 5s         │    │ Manual dismiss  │
    └─────────────┬────────────┘    └────────┬────────┘
                  │                          │
                  └──────────┬───────────────┘
                             │
                  reset() called on dismiss
                             │
                             ▼
                        IDLE again
```

## Hook Usage Pattern

```typescript
//  Component using useTransactionFeedback hook
//
//  const { pending, confirming, success, failure, reset, isLoading } 
//         = useTransactionFeedback();

// 1. Initiate
pending("Building transaction...");

// 2. Work (async call)
// → User waits, spinner shows
// → User sees: "Building transaction..."

// 3. Next step
confirming("Awaiting wallet confirmation...");

// 4. Work (signing, submitting)
// → User waits, spinner still shows
// → User sees: "Awaiting wallet confirmation..."

// 5a. Success branch
success("0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d...");
// → Checkmark icon appears
// → Hash visible and copyable
// → Explorer link ready

// 5b. Failure branch
failure("Insufficient balance for transaction");
// → Error icon appears
// → Error message shown
// → User can retry or dismiss

// 6. Cleanup
reset();
// → Back to idle state
// → UI hidden
```

## useExecuteTransaction Convenience Flow

```
Call:
  executeTransaction(async () => {
    const signed = await signAndSubmitTransaction(txXdr);
    return { txHash: signed.txHash };
  });

Automatically does:
  1. pending("Processing transaction...")
  2. Calls your function
  3. confirming("Confirming on blockchain...")
  4. Waits for result
  5. success(result.txHash) or failure(error)
     
Returns:
  { success: true, txHash: "..." } or
  { success: false, error: "..." }
```

## File Dependency Graph

```
─── Application ───

app/layout.tsx
  │
  └─→ TransactionFeedbackProvider (context)
        │
        ├─→ AnyComponent
        │    │
        │    └─→ useTransactionFeedback() hook
        │          │
        │          ├─→ TransactionFeedbackPanel
        │          └─→ TransactionFeedbackToast

─── Core System ───

TransactionFeedbackContext.tsx
  ├─→ types/transaction.ts (imports types)
  └─→ React (no other deps)

useTransactionFeedback.ts
  ├─→ TransactionFeedbackContext
  └─→ types/transaction.ts

TransactionFeedbackPanel.tsx
  ├─→ TransactionFeedbackContext
  ├─→ types/transaction.ts
  └─→ UI components (Button, Card, Badge, Text)

TransactionFeedbackToast.tsx
  ├─→ TransactionFeedbackContext
  ├─→ types/transaction.ts
  └─→ sonner (toast library)

─── Zero new external dependencies ───
All use existing project libraries!
```

## Real-World Example Flow

```
User clicks: "Create Escrow Order"
│
├─ Component receives click
├─ setFeedbackOpen(true)             ← Panel appears
├─ pending("Building escrow order...")
│  │
│  ├─→ Panel shows: spinner + message
│  └─→ Toast shows: loading toast
│
├─ Calls: createOrder(...)
│
├─ confirming("Confirm in wallet...")
│  │
│  ├─→ Panel updates message
│  └─→ Toast updates
│
├─ Calls: signAndSubmitTransaction(...)
│
├─ Wallet opens for signature
│  │
│  └─→ User signs manually
│
├─ Returns signed transaction hash
│
├─ success("0a1b2c3d...")
│  │
│  ├─→ Panel: Shows checkmark ✓
│  ├─→ Panel: Displays hash
│  ├─→ Panel: Copy button available
│  ├─→ Panel: "View on Explorer" link
│  ├─→ Toast: "Transaction confirmed!"
│  └─→ Toast: "View on Explorer" link
│
├─ Auto-dismiss in 5 seconds (configurable)
│
└─ User can manually click "Close" to dismiss now
   │
   └─→ reset()  →  Back to idle
       All UI hidden
       Ready for next transaction
```

---

## Key Design Principles

1. **Single Source of Truth** — One context manages all feedback state
2. **Reactive** — UI auto-updates when state changes
3. **No Polling** — Event-driven state updates
4. **Composable** — Use with panel, toast, or custom UI
5. **Type-Safe** — Full TypeScript support
6. **Framework Agnostic** — Pure React, no Next.js/Remix specifics
7. **Minimal Dependencies** — Only React (no new packages)
8. **Easy Testing** — Context easily mockable in tests

---

End of Architecture Documentation
