# Contributing to Agrocylo-Global

Thank you for your interest in contributing to Agrocylo-Global! This guide explains how to get started.

## Overview

Agrocylo-Global is an Agro-DeFi platform built on Stellar/Soroban. The repository contains:

- **Production focus:** `agro-production/` — campaign-based crowdfunding (current Stellar Wave program)
- **Marketplace:** Root `client/` and `server/` — peer-to-peer trade (mature, lower priority)
- **Smart contracts:** `contracts/` and `agro-production/contract/` (Rust/Soroban)

**New to the repo?** Start with [ARCHITECTURE.md](ARCHITECTURE.md) to understand the structure.

---

## How to Contribute

### 1. Find an Issue

Issues are tracked in **[GitHub Issues](https://github.com/Cylo-Traders/Agrocylo-Global/issues)**.

**Browse labels:**
- `area:frontend` — Next.js/React work
- `area:backend` — Express/Node.js work
- `area:contracts` — Rust/Soroban work
- `type:bug` — Bugs
- `type:feature` — New features
- `type:refactor` — Code quality
- `good-first-issue` — Recommended for new contributors
- `Stellar Wave` — Suitable for external contribution (bounty-eligible)

### 2. Discuss Before Starting

Comment on the issue to let maintainers know you're interested. For substantial features, wait for feedback before starting work.

### 3. Set Up Locally

#### For Frontend
```bash
cd agro-production/client  # or cd client/ for root marketplace
npm install
npm run dev
# Open http://localhost:3000
```

#### For Backend
```bash
cd agro-production/server  # or cd server/ for root marketplace
npm install
npm run dev
# Server runs on http://localhost:3001
```

#### For Smart Contracts
```bash
cd agro-production/contract/production_escrow  # or other contract dir
cargo build
cargo test
```

See respective `README.md` files in each directory for more details.

### 4. Make Your Changes

**Code style:**
- Follow existing patterns in the codebase
- Use TypeScript for backend/frontend (no implicit `any`)
- Use Rust's `rustfmt` for contract code
- Keep commits atomic and descriptive

**Before committing:**
- Run tests: `npm test` (frontend/backend) or `cargo test` (contracts)
- Type-check: `npm run type-check` or `cargo check`
- Lint: `npm run lint` or `cargo clippy`

### 5. Write a Descriptive Commit Message

Format: `<type>: <description> (#<issue-number>)`

Examples:
```
feat: add campaign creation form (#445)
fix: prevent wallet connection stale state (#446)
refactor: consolidate escrow hooks (#447)
docs: add contribution guide (#722)
```

### 6. Open a Pull Request

- **Base branch:** `main`
- **Title:** Reference the issue (`Fix #123` or `Closes #456`)
- **Description:** Explain what you changed and why (see template in PR)
- **Tests:** Include tests for new features or bug fixes
- **No breaking changes:** If your change affects the API or contract interface, discuss with maintainers first

### 7. Code Review

Maintainers will review your PR and may request changes. Address feedback promptly.

Once approved, a maintainer will merge your PR.

---

## Development Workflow

### New Features
1. File a GitHub issue with a description and proposed solution
2. Wait for feedback; ensure it aligns with project scope
3. Create a branch off `main`
4. Implement feature
5. Add tests and documentation
6. Open PR and address review feedback

### Bug Fixes
1. File or comment on an existing GitHub issue
2. Create a branch off `main`
3. Fix the bug and add a test to prevent regression
4. Open PR linking to the issue

### Documentation
1. Submit improvements to README.md, ARCHITECTURE.md, API.md, or in-code comments
2. No issue needed for minor doc fixes
3. For major additions, file an issue first

---

## Important Guidelines

### ✅ Do
- Reference GitHub issues in commits and PRs
- Write atomic, focused commits
- Include tests for new features
- Update documentation if you change APIs
- Test locally before pushing
- Ask questions in GitHub issues if unclear

### ❌ Don't
- Add new in-tree backlog documents (use GitHub Issues instead)
- Break existing functionality without discussion
- Commit large binary files (use CDN/external hosting)
- Skip tests or type-checking
- Force-push to `main` (maintainers only)
- Commit secrets or environment keys

---

## Issue Triage & Backlog

Previously, this repo maintained in-tree backlog documents (`client/issues.md`, `server/issues.md`). **These have been removed.**

**Why?**
- Duplication with GitHub Issues (the single source of truth)
- No assignment, labels, or linkage to PRs
- Quickly goes stale without continuous sync

**How to contribute ideas now:**
1. File a GitHub issue with a clear title and description
2. Add relevant labels (`type:feature`, `area:frontend`, etc.)
3. Discuss scope with maintainers before implementing

See [BACKLOG_TRIAGE.md](BACKLOG_TRIAGE.md) for details on which items from the old backlog became real issues.

---

## Repository Structure Quick Reference

| Directory | Purpose |
|-----------|---------|
| `agro-production/client/` | Campaign marketplace frontend (Next.js) |
| `agro-production/server/` | Campaign API & event indexer (Express) |
| `agro-production/contract/` | Soroban contracts (Rust) — production_escrow, registry, investment_basket, governance |
| `client/` | Root marketplace frontend (Next.js) |
| `server/` | Root marketplace API (Express) |
| `contracts/` | Other contracts (Rust) — escrow, weather-insurance |
| `ARCHITECTURE.md` | Detailed repo map and data flows |
| `.github/workflows/` | CI/CD pipelines |

For full documentation: See [ARCHITECTURE.md](ARCHITECTURE.md) and individual `README.md` files in each directory.

---

## Questions?

- **Repo structure:** See [ARCHITECTURE.md](ARCHITECTURE.md)
- **API endpoints:** See `server/API.md` or `agro-production/server/API.md`
- **Smart contracts:** See `contract/` or `agro-production/contract/` README files
- **Issues:** Browse [GitHub Issues](https://github.com/Cylo-Traders/Agrocylo-Global/issues)
- **Stellar Wave bounties:** Check issue labels for `Stellar Wave`

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/).

Be respectful, inclusive, and constructive in all interactions.

---

## License

All contributions are licensed under the same license as the project (see LICENSE file).

By submitting a pull request, you agree that your contribution is licensed under this license.
