# Frontend Issues for `client`

This document collects frontend improvement opportunities for the Agrocylo `client` app.

## 1. Optimization / Refactoring

### 1.1. Optimize product and listing images
**Objective / Summary**
- Improve page performance and load times by using optimized image delivery instead of raw `<img>` tags.

**Path**
- `/Agrocylo-Global/client`, especially `src/components/ProductCard.tsx`, `src/components/ProductGrid.tsx`, `src/components/ProductCard.tsx`, and other listing UI.

**Proposed solution**
- Replace raw `img` usage with `next/image` or a custom image wrapper.
- Add `loading="lazy"`, width/height props, and a lightweight placeholder for missing images.
- Remove `@next/next/no-img-element` ESLint disables by using supported Next.js image handling.

**Acceptance criteria**
- Product and listing cards render with `next/image` or a standard optimization wrapper.
- There are no ESLint disable comments for `@next/next/no-img-element` in the updated components.
- Page load size and image weight are reduced on the marketplace product listing page.

**Tests needed**
- Unit/snapshot test verifying `next/image` is used in critical product components.
- Lighthouse or manual performance validation showing improved image load timing.

### 1.2. Reduce bundle size by lazy-loading heavy client-only modules
**Objective / Summary**
- Decrease initial client JS bundle size and speed up first paint by deferring expensive browser-only modules.

**Path**
- `/Agrocylo-Global/client`, targeting map/chart pages such as `src/components/map/FarmerMap.tsx`, `src/components/PriceChart.tsx`, `src/app/(root)/marketplace/page.tsx`, and dashboard/chart components.

**Proposed solution**
- Convert large visual components such as Leaflet maps and charts to dynamic imports.
- Use `next/dynamic` with `ssr: false` for browser-only modules.
- Render skeleton placeholders until the heavy components are ready.

**Acceptance criteria**
- Heavy map/chart modules are not included in the initial bundle for pages that do not immediately show them.
- The marketplace and dashboard pages render faster on first load.
- Map components still load correctly when the user scrolls to or opens the map view.

**Tests needed**
- Bundle analysis or `next build` inspection showing reduced initial JS weight.
- Component-level test ensuring lazy-loaded modules render after mount.

### 1.3. Convert suitable components to server components
**Objective / Summary**
- Reduce client-side rendering overhead by moving stateless and data-driven UI into Next.js server components.

**Path**
- `/Agrocylo-Global/client/src/app` and related UI components such as marketplace and campaign list pages.

**Proposed solution**
- Audit and identify pages/components with no browser state or client-only requirements.
- Move those items to server components and only keep true interactive UI in client components.
- Use server-fetching for product list data where possible, then hydrate interactive equipment with lightweight client wrappers.

**Acceptance criteria**
- At least one major page or listing component is converted from client to server component.
- The server-rendered page still loads correctly and retains client interactivity where required.
- Client bundle size decreases for the converted page.

**Tests needed**
- Regression test for converted server component content.
- Validation that interactive bits continue to work after conversion.

### 1.4. Improve data caching and request reuse
**Objective / Summary**
- Prevent duplicate data requests and improve responsiveness by leveraging shared caching for repeated endpoints.

**Path**
- `/Agrocylo-Global/client/src/hooks/queries`, `src/app/orders/page.tsx`, `src/app/farmer-dashboard/page.tsx`, `src/app/(dashboard)`, and shared API hooks.

**Proposed solution**
- Standardize on react-query caching across `useOrders`, `useProducts`, `useNotifications`, and profile queries.
- Reuse shared query keys and remove duplicate `fetch()` calls within page effect hooks.
- Add stale-while-revalidate behavior where appropriate.

**Acceptance criteria**
- Pages do not issue redundant requests for the same dataset during normal navigation.
- Cached data is reused across routes when the same query key is present.
- UI refreshes correctly when stale data invalidation occurs.

**Tests needed**
- Unit tests for reusable query hooks verifying cache key consistency.
- Manual or automated test ensuring navigating back and forth does not re-fetch identical data unnecessarily.

### 1.5. Reduce duplicate hook state in order details
**Objective / Summary**
- Clean up duplicated transaction hook instances and make order detail flow easier to maintain.

**Path**
- `/Agrocylo-Global/client/src/app/(root)/orders/[orderId]/page.tsx` and `src/hooks/useEscrowContract.ts`.

**Proposed solution**
- Consolidate the confirm/refund/dispute contract actions into one shared `useEscrowContract` hook instance.
- Expose a single transaction API object that supports all escrow interactions and unified status state.
- Remove redundant hook calls inside `OrderDetailsPage`.

**Acceptance criteria**
- `OrderDetailsPage` uses only one call to `useEscrowContract()` for all transaction actions.
- Transaction state is consistent and not duplicated across confirm/refund/dispute flows.
- The order detail page still displays action success and error states correctly.

**Tests needed**
- Hook unit test verifying one hook instance can perform multiple escrow actions.
- Page-level test ensuring confirm/refund/dispute buttons correctly update the transaction state.

## 2. Bug fixes

### 2.1. Fix copy-to-clipboard fallback behavior
**Objective / Summary**
- Make the copy button reliable and accessible by surfacing fallback failures to users rather than hiding them in the console.

**Path**
- `/Agrocylo-Global/client/src/components/shared/copy-button.tsx`.

**Proposed solution**
- Add explicit error state and visible feedback when the fallback copy path fails.
- Use an accessible `role="alert"` or toast for copy failure messages.
- Ensure `aria-live` is used meaningfully for status updates.

**Acceptance criteria**
- Users receive visible feedback when copy succeeds or fails.
- There is no longer only a console log on failure.
- The component remains keyboard and screen-reader accessible.

**Tests needed**
- Unit tests for success and failure states in `CopyButton`.
- Accessibility test for `aria-live` announcements and button label changes.

### 2.2. Improve wallet connection restore and stale state handling
**Objective / Summary**
- Prevent stale wallet state from being shown during restore from localStorage.

**Path**
- `/Agrocylo-Global/client/src/context/WalletContext.tsx` and wallet adapter logic in `/Agrocylo-Global/client/src/lib/walletAdapters.ts`.

**Proposed solution**
- Do not set connected state until the wallet adapter has successfully verified the public key and network.
- Show a loading/verification state while restoring from localStorage.
- Clear local cache when restore fails.

**Acceptance criteria**
- The app does not show `connected` true until the wallet is fully verified.
- If the wallet is unavailable or locked, the user sees a disconnected state instead of stale UI.
- LocalStorage is cleared when restore verification fails.

**Tests needed**
- Unit test for restore flow when localStorage contains stale wallet address.
- Integration test covering wallet disconnect / reconnect restore behavior.

### 2.3. Surface contract and order submission errors clearly
**Objective / Summary**
- Ensure users can see actionable error messages when contract interactions fail.

**Path**
- `/Agrocylo-Global/client/src/app/(root)/orders/[orderId]/page.tsx`, `src/hooks/useEscrowContract.ts`, and related transaction state components.

**Proposed solution**
- Remove silent `catch` blocks and propagate hook errors into page-level state.
- Add inline error banners or toast messages for failed confirm/refund/dispute attempts.
- Normalize transaction errors through the existing error handling utilities.

**Acceptance criteria**
- Failed escrow actions display an explicit error message in the UI.
- Error details are actionable and not hidden from users.
- Success workflows still behave as expected.

**Tests needed**
- Page test simulating a failed contract action and verifying visible error output.
- Unit test for error propagation from `useEscrowContract`.

### 2.4. Fix missing contract environment warning handling
**Objective / Summary**
- Prevent contract-dependent UI from continuing with an invalid configuration.

**Path**
- `/Agrocylo-Global/client/src/services/stellar/networkConfig.ts` and pages/components that call contract APIs.

**Proposed solution**
- Convert the current `console.warn` into a runtime validation error for contract-dependent initialization.
- Add a graceful fallback UI for missing `NEXT_PUBLIC_CONTRACT_ID` instead of allowing contract calls to fail later.
- Document the required env var in README and `.env.example` if not already explicit.

**Acceptance criteria**
- The app warns and blocks contract-dependent actions when `NEXT_PUBLIC_CONTRACT_ID` is missing.
- Users see a clear message about the missing configuration.
- No silent network or contract errors occur downstream from the bad config.

**Tests needed**
- Unit test verifying `getNetworkConfig()` throws or returns a flagged error when contract ID is missing.
- Manual test verifying the contract page displays the fallback UI.

### 2.5. Add debounce for notification search / filter inputs
**Objective / Summary**
- Reduce backend request churn and improve notification panel UX with debounced input handling.

**Path**
- `/Agrocylo-Global/client/src/components/NotificationCenter.tsx` and `src/hooks/useNotifications.ts`.

**Proposed solution**
- Add debounce to search input and filter state changes before triggering network calls.
- Preserve filter/search values when switching tabs and avoid immediate calls for every keystroke.
- Optionally use `useTransition` or `lodash.debounce` for stable updates.

**Acceptance criteria**
- Notification requests are not triggered on every keystroke.
- Search and filter state is preserved when switching tabs or re-opening the panel.
- The notification list still updates promptly after the user stops typing.

**Tests needed**
- Unit test for debounce behavior in the notification hook or component.
- End-to-end test ensuring search still filters notifications correctly after debounce.

### 2.6. Ensure correct order expiration state and timing
**Objective / Summary**
- Fix order expiry display so it always matches backend state and boundary transitions.

**Path**
- `/Agrocylo-Global/client/src/app/(root)/orders/[orderId]/page.tsx`.

**Proposed solution**
- Recompute expiry using a more precise moment and verify against server status on updates.
- Use `setTimeout` to update at the exact expiry boundary instead of polling every minute.
- Add a status invalidation path when order state changes from the backend.

**Acceptance criteria**
- The expiry timer switches to expired exactly when the window closes.
- UI actions like confirm/refund reflect the latest expiry state.
- There are no stale expired/active states after backend updates.

**Tests needed**
- Unit test for the expiry timer logic at boundary times.
- Integration test verifying expired orders show the refund action instead of confirm.

## 3. New feature ideas

### 3.1. Add mobile wallet support and alternative wallet adapters
**Objective / Summary**
- Make the frontend usable on mobile devices by supporting wallet adapters beyond Freighter.

**Path**
- `/Agrocylo-Global/client/src/lib/walletAdapters.ts`, `src/context/WalletContext.tsx`, and wallet UI components.

**Proposed solution**
- Add WalletConnect or another mobile-friendly Stellar wallet adapter.
- Create a wallet adapter selection modal and mobile onboarding flow.
- Update wallet connect UI to show adapter-specific install/deep-link guidance.

**Acceptance criteria**
- Mobile users can connect with at least one supported wallet adapter.
- The wallet selection modal clearly shows desktop vs mobile options.
- Existing desktop Freighter support continues working.

**Tests needed**
- Component test for wallet adapter selection UI.
- End-to-end/mobile workflow test for selecting and connecting a mobile wallet.

### 3.2. Add wishlist/favorites and saved search filters
**Objective / Summary**
- Improve buyer retention by allowing users to save favorite products and restore marketplace searches.

**Path**
- `/Agrocylo-Global/client/src/components/marketplace`, `src/services/productService.ts`, and route files under `src/app/(root)`.

**Proposed solution**
- Add favorites/bookmark controls on product cards.
- Persist saved filters to localStorage or backend user profile.
- Add a favorites list or saved filters panel.

**Acceptance criteria**
- Users can mark/unmark favorites from marketplace cards.
- Favorites are stored persistently and reused on subsequent visits.
- Saved filter values restore when the user returns to the marketplace.

**Tests needed**
- Unit test for the favorite toggle and persistence layer.
- UI test verifying favorites appear in the saved list.

### 3.3. Add order tracking timeline and delivery status UI
**Objective / Summary**
- Provide clearer order lifecycle visibility with a timeline of escrow and delivery events.

**Path**
- `/Agrocylo-Global/client/src/components/orders`, `src/app/(root)/orders/[orderId]/page.tsx`.

**Proposed solution**
- Create an order timeline component showing `Created`, `Escrow funded`, `Shipped`, `Delivered`, `Dispute opened`, etc.
- Surface current status and next recommended actions for buyer/seller.
- Integrate with existing webhook/state updates.

**Acceptance criteria**
- Order details page includes a visible timeline panel.
- Each order event has a timestamp and descriptive label.
- Timeline updates when order state changes.

**Tests needed**
- Component test for the timeline rendering with sample event data.
- End-to-end test verifying state-driven timeline updates.

### 3.4. Add notification preferences and alert settings
**Objective / Summary**
- Give users control over the notifications they receive for orders, disputes, and system updates.

**Path**
- `/Agrocylo-Global/client/src/components/NotificationPreferences.tsx`, `src/app/(dashboard)/dashboard/settings/page.tsx`, and notification service logic.

**Proposed solution**
- Add a preferences UI with toggles for order, dispute, and system notifications.
- Persist preferences to backend user settings or localStorage.
- Apply preferences when loading notifications or sending alerts.

**Acceptance criteria**
- Settings page includes notification toggles.
- Preferences are stored and respected on reload.
- Notifications panel filters out disabled categories.

**Tests needed**
- Unit test for preferences toggle behavior.
- Integration test verifying notification delivery respects the chosen settings.

### 3.5. Add a PWA install/offline experience
**Objective / Summary**
- Improve usability with install prompts and an offline fallback for cached content.

**Path**
- `/Agrocylo-Global/client/src/app/manifest.ts`, `src/app/offline`, and related PWA UI components.

**Proposed solution**
- Surface a PWA install prompt when the app is eligible.
- Add an offline page and fallback UI for navigation when network is unavailable.
- Cache product listing and user dashboard data for basic offline browsing.

**Acceptance criteria**
- The app shows install guidance when PWA install criteria are met.
- There is a functioning offline fallback route/page.
- Basic cached content is available when offline.

**Tests needed**
- Manual PWA install test.
- Offline experience test for cached page rendering.

### 3.6. Add support for multi-language / localization improvements
**Objective / Summary**
- Enable non-English users to use the app by expanding localized content and language selection.

**Path**
- `/Agrocylo-Global/client/src/app/messages`, `src/components`, and `next-intl` configuration.

**Proposed solution**
- Add a language selector and support at least one additional locale.
- Audit pages for hardcoded text and move strings into translation files.
- Ensure UI direction and formatting support local conventions.

**Acceptance criteria**
- The app supports at least one additional language via `next-intl`.
- Key pages render in the selected locale.
- No remaining hardcoded user-facing strings in audited pages.

**Tests needed**
- Localization snapshot test for translated pages.
- End-to-end test switching language and validating content changes.

### 3.7. Add seller/buyer chat or message thread support
**Objective / Summary**
- Improve dispute prevention with direct buyer-seller messaging inside the order workflow.

**Path**
- `/Agrocylo-Global/client/src/components/ChatWindow.tsx`, `/src/app/(root)/orders/[orderId]/page.tsx`, and messaging hooks.

**Proposed solution**
- Add a chat thread component to order detail pages.
- Use existing backend messaging or a new lightweight messaging API endpoint.
- Show message history and allow buyers/sellers to send text updates during order processing.

**Acceptance criteria**
- Buyers and sellers can send and view messages on order pages.
- Messages are persisted and reloaded when the page refreshes.
- The chat UI is embedded without blocking the main order flow.

**Tests needed**
- Component test for chat input and message list.
- Flow test verifying message persistence across reloads.

## 4. Contributor-friendly tasks

### 4.1. Add Vitest and Playwright coverage for checkout + wallet flow
**Objective / Summary**
- Increase frontend regression coverage for wallet checkout and ordering flows.

**Path**
- `/Agrocylo-Global/client/vitest.config.ts`, `src/__tests__`, and `client/e2e`.

**Proposed solution**
- Add a Vitest unit test for wallet connect UI and checkout button behavior.
- Add a Playwright E2E scenario covering wallet connection, order creation, and confirmation.

**Acceptance criteria**
- There is at least one unit test covering the checkout flow.
- There is at least one E2E test that validates wallet connection and order placement.
- Tests run successfully in CI-compatible mode.

**Tests needed**
- Vitest unit tests for `CopyButton` and checkout page states.
- Playwright scenario for wallet connect and order completion.

### 4.2. Add accessibility regression tests for the marketplace
**Objective / Summary**
- Catch accessibility regressions early by extending existing a11y coverage.

**Path**
- `/Agrocylo-Global/client/src/a11y.test.tsx`, `src/components`, and marketplace pages.

**Proposed solution**
- Add tests for filter forms, modals, and wallet connect interactions.
- Validate focus management and keyboard navigation for the notification panel.
- Add role and label assertions for key interactive elements.

**Acceptance criteria**
- New accessibility tests cover at least marketplace filters, modal dialogs, and wallet UI.
- The test suite passes with `npm run test:a11y`.
- Document any accessibility fixes that were required.

**Tests needed**
- New Vitest a11y assertions for the marketplace page.
- Accessibility test for notification panel keyboard navigation.

### 4.3. Add documentation for contributing to frontend features
**Objective / Summary**
- Make it easier for open-source contributors to understand frontend architecture, patterns, and issue workflow.

**Path**
- `/Agrocylo-Global/client/CONTRIBUTING.md`, `README.md`, and existing documentation files.

**Proposed solution**
- Add or extend a CONTRIBUTING guide with frontend-specific sections.
- Document how to run the app, tests, and how to add new wallet adapters or translations.
- Include a checklist for issue creation and PR review.

**Acceptance criteria**
- The `client` folder includes clear contributor documentation.
- New contributors can follow the guide to run the frontend locally and submit a fix.
- The docs reference the existing `issues.md` backlog.

**Tests needed**
- Manual review of documentation completeness.
- Optionally, add a docs lint step if the repository supports it.

---

> These issue cards now include objective summaries, scope, proposed improvements, acceptance criteria, and testing guidance for the frontend `client` app.
