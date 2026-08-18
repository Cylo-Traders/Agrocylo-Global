# Backlog Triage Analysis — Issue #722

This document records the triage of items from `client/issues.md` and `server/issues.md`, identifying which should become real GitHub issues and which can be discarded.

**Date:** 2026-07-30  
**Triage by:** tukura11 (Admailo)  
**Status:** Backlog removed (see CONTRIBUTING.md for new contribution workflow)

---

## Triage Principles

1. **Critical path first** — Items blocking core user flows get filed as issues
2. **Actionable & specific** — Vague optimization ideas are deprioritized
3. **Stellar Wave alignment** — Prioritize items suitable for external contributors
4. **Not duplicating work** — Cross-check against existing GitHub Issues before filing

---

## Frontend Backlog (from `client/issues.md`)

### Section 1: Optimization / Refactoring

| Item | Title | Status | Decision | Rationale |
|------|-------|--------|----------|-----------|
| 1.1 | Optimize product/listing images | NICE-TO-HAVE | **Skip (no issue)** | Performance optimization, not blocking. Can revisit post-MVP. |
| 1.2 | Reduce bundle size via lazy-loading | NICE-TO-HAVE | **Skip (no issue)** | Same as 1.1 — optimization, not core. |
| 1.3 | Convert components to server components | NICE-TO-HAVE | **Skip (no issue)** | Architecture refactor, not blocking MVP. |
| 1.4 | Improve data caching & request reuse | TECH-DEBT | **Skip (no issue)** | React Query caching is working; optimization can wait. |
| 1.5 | Reduce duplicate hook state in order details | CODE-QUALITY | **PARTIAL** | File as **type:refactor** if contributor time available, but not blocking. |

**Summary:** All 1.x items are optimizations. None are filed as issues. Recommendation: revisit after MVP stabilization.

---

### Section 2: Bug Fixes

| Item | Title | Status | Decision | Rationale |
|------|-------|--------|----------|-----------|
| 2.1 | Fix copy-to-clipboard fallback behavior | BUG | **FILE ISSUE** ✓ | UX bug with visible impact (copy fails silently). Small scope, good first issue. |
| 2.2 | Improve wallet connection restore & stale state | BUG | **FILE ISSUE** ✓ | Core wallet flow; affects user experience on page reload. Critical for reliability. |
| 2.3 | Surface contract & order submission errors clearly | BUG | **FILE ISSUE** ✓ | Users can't debug failed transactions. Blocks external API contract. |
| 2.4 | Fix missing contract env var validation | BUG | **FILE ISSUE** ✓ | Silent failures if config missing; should fail fast. Prevents misconfiguration. |
| 2.5 | Add debounce for notification search/filter | PERF | **SKIP** | Nice-to-have; not affecting current flows significantly. |
| 2.6 | Ensure correct order expiration state & timing | BUG | **SKIP** | Root marketplace (not current focus); defer for later. |

**Summary:** File 4 issues (2.1, 2.2, 2.3, 2.4). These are core bug fixes affecting MVP.

---

### Section 3: New Feature Ideas

| Item | Title | Scope | Decision | Rationale |
|------|-------|-------|----------|-----------|
| 3.1 | Add mobile wallet support | LARGE | **SKIP** | Out of scope for Stellar Wave Phase 1. |
| 3.2 | Add wishlist/favorites | MEDIUM | **SKIP** | Nice-to-have marketplace feature; not MVP. |
| 3.3 | Add order tracking timeline | MEDIUM | **SKIP** | Root marketplace focus (not current). |
| 3.4 | Add notification preferences | SMALL | **SKIP** | Enhancement; not blocking current workflows. |
| 3.5 | Add PWA install/offline experience | MEDIUM | **SKIP** | Web platform enhancement; not MVP. |
| 3.6 | Add multi-language/localization | MEDIUM | **SKIP** | Future i18n work; not blocking. |
| 3.7 | Add seller/buyer chat | MEDIUM | **SKIP** | Feature-nice-to-have; can be revisited. |

**Summary:** All 3.x items skipped. These are feature ideas for post-MVP; revisit quarterly.

---

### Section 4: Contributor-friendly Tasks

| Item | Title | Scope | Decision | Rationale |
|------|-------|-------|----------|-----------|
| 4.1 | Add Vitest & Playwright test coverage | MEDIUM | **FILE ISSUE** ✓ | Good first issues for contributors; testing is always valuable. |
| 4.2 | Add accessibility regression tests | MEDIUM | **FILE ISSUE** ✓ | A11y testing is important; good contribution task. |
| 4.3 | Add documentation for frontend contributors | SMALL | **PARTIAL** | Partially covered by new CONTRIBUTING.md (this repo). Consider adding client-specific CONTRIBUTING.md later. |

**Summary:** File 2 issues (4.1, 4.2) for test coverage as good-first-issues for external contributors.

---

## Backend Backlog (from `server/issues.md`)

### Critical Path (High Priority)

| Item | Title | Impact | Decision | Rationale |
|------|-------|--------|----------|-----------|
| 1 | Contract watcher resilience | HIGH | **FILE ISSUE** ✓ | Affects event indexing reliability. Critical for production. |
| 2 | Unified API error handling (RFC7807) | HIGH | **FILE ISSUE** ✓ | Blocks external API contract; required for client integration. |
| 5 | Harden wallet auth & token lifecycle | HIGH | **FILE ISSUE** ✓ | Security issue; nonce replay prevention is critical. |
| 10 | Add contract config validation at startup | MEDIUM | **FILE ISSUE** ✓ | Prevents silent failures; fail-fast is important. |

**Summary:** File 4 critical backend issues (1, 2, 5, 10).

---

### Important Features (Medium Priority)

| Item | Title | Impact | Decision | Rationale |
|------|-------|--------|----------|-----------|
| 3 | Improve WebSocket auth & broadcast robustness | MEDIUM | **SKIP** | Important but can be addressed incrementally. Not blocking MVP. |
| 7 | Add observability & health checks | MEDIUM | **SKIP** | Operational readiness; defer to Phase 2. |
| 9 | Add backend documentation | LOW | **PARTIAL** | Partially addressed by ARCHITECTURE.md (this repo). Consider adding `agro-production/server/CONTRIBUTING.md` later. |

**Summary:** Defer 3 items (3, 7, 9) to Phase 2. Items 3 and 7 can become issues if MVP proves problematic.

---

### Optimization & Testing

| Item | Title | Impact | Decision | Rationale |
|------|-------|--------|----------|-----------|
| 4 | Optimize Prisma queries & order stats | MEDIUM | **SKIP** | Performance optimization; revisit if queries show in profiling. |
| 6 | Add API rate limiting & upload validation | MEDIUM | **SKIP** | Security hardening; important but not MVP-blocking. File post-MVP. |
| 8 | Improve backend test coverage | MEDIUM | **SKIP** | Testing is always good; defer to Phase 2. Can be good-first-issue later. |

**Summary:** Defer 3 items (4, 6, 8) to Phase 2 or post-MVP.

---

## Summary of Issues to File

### TOTAL: 11 GitHub Issues to File

**Backend (4 critical):**
- [ ] server/1 — Contract watcher resilience (polling, backoff, checkpoint recovery)
- [ ] server/2 — Unified API error handling (RFC7807 problem responses)
- [ ] server/5 — Harden wallet auth (nonce replay prevention, refresh rotation)
- [ ] server/10 — Contract config validation at startup (fail-fast)

**Frontend (6 bug fixes + 2 test tasks):**
- [ ] client/2.1 — Copy-to-clipboard error feedback
- [ ] client/2.2 — Wallet connection restore (stale state handling)
- [ ] client/2.3 — Surface contract/order submission errors (user-facing)
- [ ] client/2.4 — Missing contract env var validation (fail-fast)
- [ ] client/4.1 — Add Vitest & Playwright test coverage (good-first-issue)
- [ ] client/4.2 — Add accessibility regression tests (good-first-issue)

---

## Items Discarded or Deferred

### Discarded (no issue needed)
- client/issues 1.1-1.5 — Optimizations; revisit post-MVP
- client/issues 3.1-3.7 — Feature ideas; outside Stellar Wave scope
- server/issues 4, 6, 8 — Optimization & testing; Phase 2 candidates

### Deferred to Phase 2
- server/issues 3, 7 — WebSocket hardening & observability (nice-to-have)
- server/issues 9 — Backend docs (partially addressed by ARCHITECTURE.md)
- client/issues 2.5, 2.6 — Notification debounce & order timing (root marketplace, not current focus)

---

## Labels for Filing

All issues will be labeled with:
- **type:bug** or **type:feature** or **type:refactor**
- **area:frontend** or **area:backend**
- **Stellar Wave** (to indicate external contribution eligibility)
- Optional: **good-first-issue** (for 4.1, 4.2)

---

## Removal of Backlog Files

After this triage:
1. ✓ ARCHITECTURE.md created (addresses #725)
2. ✓ GitHub issues will be filed from this triage
3. ⏳ client/issues.md will be **deleted**
4. ⏳ server/issues.md will be **deleted**
5. ✓ CONTRIBUTING.md updated with direction to file issues in GitHub (not in-tree)

---

## See Also

- New issues should be filed in GitHub Issues, not added to in-tree backlog docs
- See CONTRIBUTING.md for contribution workflow
- See ARCHITECTURE.md for repo structure and context
