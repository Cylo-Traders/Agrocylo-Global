# Dependency upgrade policy (Next.js workspaces)

Applies to the two Next.js workspaces, `client` and
`agro-production/client`, and is enforced in CI by
`scripts/check-shared-versions.js` (Issues #755, #728, #923).

## Why

Both apps are npm workspace members sharing one root install and one root
lockfile, and they are deployed side by side. A version skew between them is a
class of bug that only shows up at runtime (two React copies, two Next.js
runtimes, divergent lint rules), so it is caught in CI instead.

## The policy

1. **Presence.** Every client declares `next`, `react`, `react-dom` and
   `eslint-config-next`. A missing entry fails the check and names the app and
   the package.
2. **Alignment.** Both clients declare the *same* version of each of those
   packages. Versions are compared after resolving range syntax
   (`^16.3.5` resolves to `16.3.5`), not by comparing the first digit — so a
   `16.2.4` vs `^16.3.5` skew fails even though both are "major 16".
3. **Lockstep.** `eslint-config-next` is released alongside Next.js and must
   match the app's `next` version **exactly** (`major.minor.patch`). Upgrading
   Next.js while leaving `eslint-config-next` behind fails the check with the
   app and both package names.
4. **One lockfile.** An upgrade updates both app manifests **and** the single
   root `package-lock.json` in the same commit. Do not touch unrelated
   packages in an upgrade PR.

## How to upgrade

```bash
# 1. Bump both packages in BOTH app manifests (same version).
#    client/package.json and agro-production/client/package.json
# 2. Refresh the root lockfile.
npm install                       # from the repository root
# 3. Verify the policy.
npm run check:versions            # manifest-only, runs before install too
npm run check:versions -- --verify-lockfile   # also checks the root lockfile
node scripts/check-shared-versions.js --verify-installed  # also checks node_modules
# 4. Run lint/build/tests for both apps.
npm run lint && npm run build && npm test
```

## What the check does and does not do

- Reads the two app manifests only, so it works on a fresh checkout before
  `npm ci` (that keeps the CI gate fast).
- Lockfile and installed-tree verification are opt-in flags, used when the
  policy needs to prove that the manifests and the resolved tree agree.
- It never edits anything — fixing a violation is always a manual change to
  the manifests plus a lockfile refresh.

## Related troubleshooting

- `npm run doctor` — is `next` installed, and is it inside the bundler root?
  (Issue #920)
- `npm run reset:next:client` / `npm run reset:next:agro` — remove one app's
  generated `.next` output after fixing the underlying problem (Issue #921).
