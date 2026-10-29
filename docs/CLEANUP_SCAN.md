# Cleanup and security scan — 2026-10-26

Reviewed repository commit `25d942522b76e4252752249142326a757d3d78d6`
with the existing working changes preserved. This records a maintenance scan,
not a security certification or mainnet approval.

## Removed

- 9.724 GiB of regenerable output: Rust `target`, both clients' `.next`
  directories, server `dist` output, TypeScript build metadata, Soroban test
  snapshots, and snapshot-only directories left at the old contract locations.
  These directories contained no tracked files. Installed dependencies, local
  environment files, database data, and Git history were retained.
- 51 frontend modules unreachable from the checked application entrypoints and
  tests, including unused UI variants, hooks, barrel exports, and an empty theme
  placeholder. The analysis included static imports/re-exports, literal dynamic
  imports, aliases, Next.js entrypoints, instrumentation, and configuration.
- Four unused backend files: the production server's unused `tsconfig.build.json`,
  rate-limit-store implementation and Prisma mock helper, and the marketplace
  server's unused Stellar explorer utility. Active rate limiting remains in use.
- The unlinked `/escrow` sandbox page, which prepared transactions for a fixed
  sample farmer wallet. This removes an unnecessary live demo payment entrypoint;
  the address was a shared test fixture, not evidence of a malicious recipient.
- 17 unused direct dependency declarations. Removed 12 obsolete entries from
  the frontend workspace lockfile and nine from the marketplace server lockfile.
  Some removed direct dependencies remain transitively required elsewhere.
- Executable permission bits on seven TypeScript source/test files.

The 56 removed tracked source/config files totaled approximately 170 KiB. The active
images, local fonts, contract crates, migrations, tests, shared instrumentation,
and independent backend lockfiles were retained.

The root `.dockerignore` now also excludes nested dependency directories,
generated output, test snapshots, caches, build metadata, logs, and local
environment files from repository-root Docker build contexts.

## Security observations

The first-party static scan found no obvious malicious payload. Checks covered
package lifecycle hooks, executable/binary file types, resolved dependency hosts,
encoded execution and exfiltration patterns, workflow/script commands,
credential patterns, and hard-coded Stellar address occurrences. The credential
pattern match was a deliberate observability-redaction test fixture. Installer
commands matched in documentation were expected setup instructions.

This does not prove that every dependency or historical commit is malware-free.
No antivirus signature scan, runtime sandbox analysis, or independent audit of
every installed dependency was performed.

### Outstanding dependency advisories

Registry/RustSec checks identified the following **after cleanup**:

| Lockfile | Critical | High | Moderate | Low | Affected package entries |
| --- | ---: | ---: | ---: | ---: | ---: |
| Root npm workspace | 2 | 15 | 9 | 3 | 29 |
| Marketplace server | 1 | 12 | 4 | 0 | 17 |
| Production server | 1 | 10 | 3 | 0 | 14 |

These are npm audit package counts, not counts of independently exploitable
vulnerabilities; advisory propagation can count multiple packages in one chain.
The production server lockfile did not change during cleanup.

Required follow-up includes the Next.js/Sentry frontend advisories, backend
`proxy-addr` and upload/image-processing dependencies, Prisma tooling, test
tooling, and the wallet kit's transitive dependencies. Examples from the scan:

- [Next.js image optimization advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw)
- [Sentry tunnel route advisory](https://github.com/advisories/GHSA-mchm-gjx6-7h55)
- [proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)

RustSec also reported
[RUSTSEC-2026-0387](https://rustsec.org/advisories/RUSTSEC-2026-0387.html)
for transitive `crypto-bigint 0.5.5`; its reported patched range is `>=0.7.6`.
Applicability depends on the cryptographic operation and execution environment.
The Soroban SDK dependency graph needs compatibility review before changing this
cryptographic dependency. Unmaintained-crate warnings were also reported.

No framework/SDK upgrades, forced dependency downgrades, or contract changes are
included in this cleanup. Existing live-deployment security blockers continue to
require remediation and independent review.

## Validation

- Marketplace client TypeScript check: passes before and after cleanup.
- Production client TypeScript check: identical diagnostics before and after
  cleanup, including existing test-type errors and the missing `setAccessToken`
  reference. No new diagnostics were introduced by these removals.
- Changed frontend and marketplace-server lockfiles: `npm ci --dry-run
  --ignore-scripts --offline` succeeds.
- Repository script tests outside the restricted sandbox: 55 passed, one failed.
  The unchanged toolchain guard accepts npm 11 while its existing test expects
  rejection. The remaining tests pass.
- Prisma version policy: passes for both servers.
- Markdown relative-link check: passes; no links to the deleted files were found.
- Optional shared-version lockfile verification still reports missing hoisted
  `eslint-config-next` entries. The original and current lockfiles both locate
  that package under the individual client workspaces; this was not introduced
  by cleanup.
- Production-server TypeScript checking remains blocked by missing generated
  Prisma exports and existing CORS/type errors. Its build is not claimed green.

Existing staged changes were verified unchanged. No dependencies were installed
or lifecycle scripts run by the uninstall/audit/dry-run operations. Build output
is regenerated by build/development commands; a running development server has
already recreated a small `client/.next` directory.
