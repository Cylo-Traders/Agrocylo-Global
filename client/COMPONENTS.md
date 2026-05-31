# Component Library

## UI Components (src/components/ui/)

Reusable primitive components built on Radix UI primitives and Tailwind CSS.

| Component | Description |
|---|---|
| `Button` | Variants: default, destructive, outline, secondary, ghost, link. Supports `isLoading` prop. |
| `Input` | Form input with label, error, hint support. |
| `Textarea` | Multi-line text input. |
| `Select` | Dropdown select (Radix-based). |
| `Label` | Form label component. |
| `Card` | Container with header/content/footer sections. |
| `Dialog` | Modal dialog with header/content/footer. |
| `Badge` | Status badge with variants. |
| `Switch` | Toggle switch. |
| `Checkbox` | Checkbox input. |
| `Spinner` | Loading spinner. |
| `Skeleton` | Loading skeleton placeholder. |
| `Separator` | Visual divider. |
| `Tooltip` | Hover tooltip. |
| `Tabs` | Tabbed content. |
| `Avatar` | User avatar. |

## Error Components

| Component | File | Description |
|---|---|---|
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Class-based React error boundary. Wraps app root. Logs errors via logger service. |
| `ErrorDisplay` | `components/ErrorDisplay.tsx` | Displays mapped blockchain errors with title, message, action. |
| `ErrorMessage` | `components/ui/ErrorMessage.tsx` | Inline error card with retry button. |
| `AsyncBoundary` | `components/ui/AsyncBoundary.tsx` | Wraps async data fetching: shows spinner/error/children. |

## Form Components

| Component | File | Description |
|---|---|---|
| `FormField` | `components/FormField.tsx` | Unified form field (input/select/textarea) with label, error, hint. |
| `FormError` | `components/FormError.tsx` | Form-level error summary with alert icon. |

## Transaction Feedback

| Component | File | Description |
|---|---|---|
| `TransactionFeedbackProvider` | `context/TransactionFeedbackContext.tsx` | Context provider for transaction state machine (idle → pending → confirming → success/failure). |
| `TransactionFeedbackPanel` | `components/TransactionFeedbackPanel.tsx` | UI panel showing transaction state (inline or modal variant). |
| `TransactionFeedbackToast` | `components/TransactionFeedbackToast.tsx` | Sonner toast integration for transaction feedback. |

## Onboarding Components (src/components/onboarding/)

| Component | Description |
|---|---|
| `ConnectWallet` | Wallet connection step. |
| `ProfileForm` | Display name + bio step. |
| `SelectRole` | Farmer/buyer role selection. |
| `LocationConsent` | Location sharing step. |
| `Complete` | Onboarding completion screen. |
| `StepProgress` | Progress indicator for multi-step flow. |

## Shared Components (src/components/shared/)

| Component | Description |
|---|---|
| `DataTable` | TanStack Table wrapper for sortable/filterable data grids. |
| `EmptyState` | Empty state placeholder with icon, title, description, action. |
| `PageHeader` | Page title + description + actions. |
| `StatCard` | Metric display card with icon, label, value, trend. |
| `StatusBadge` | Color-coded status indicator. |
| `StarRating` | Interactive star rating. |
| `CopyButton` | Click-to-copy with visual feedback. |

## Wallet Components

| Component | File | Description |
|---|---|---|
| `WalletProviderWrapper` | `components/WalletProviderWrapper.tsx` | Composes WalletProvider + ProfileProvider + CartProvider. |
| `ConnectWallet` | `components/shared/connect-wallet.tsx` | Wallet connect/disconnect button. |
| `AuthGuard` | `components/AuthGuard.tsx` | Redirects unauthenticated users. |
