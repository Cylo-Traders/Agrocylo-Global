# Security Policy

Agrocylo's Soroban smart contracts hold and move real user funds. If you find
a vulnerability, please report it privately so it can be fixed before it is
disclosed publicly.

## Scope

- **Smart contracts (highest priority):** `contracts/escrow`,
  `archive/weather-insurance`, and the four production contracts under
  `contracts/` — `registry`, `production_escrow`,
  `investment_basket`, and `governance`.
- **Backend services:** `agro-production/server` (API, auth, webhook/escrow
  event handling, database access).
- **Frontend clients:** `agro-production/client` and `client` (wallet
  integration, transaction building/signing flows).

Out of scope: findings that require physical access to a user's device,
social engineering of maintainers, or issues in third-party dependencies that
should be reported to their own maintainers (though we'd still like to know).

## Reporting a Vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Preferred: use [GitHub Private Vulnerability Reporting](https://github.com/Cylo-Traders/Agrocylo-Global/security/advisories/new)
on this repository. It opens a private advisory visible only to maintainers
and you, and supports follow-up discussion and coordinated disclosure.

Alternative: email **security@agrocylo.io**. *(Maintainers: this address
must be created and monitored before this policy is considered active —
tracked as a follow-up on issue #805.)*

Please include:
- Affected contract, service, or file (with commit hash if possible).
- Steps to reproduce, or a proof-of-concept transaction/script.
- Potential impact (e.g. fund loss, unauthorized state change, DoS).
- Whether the issue is already public or exploited in the wild.

## Severity & Response SLA

| Severity | Examples | Acknowledgement | Remediation target |
|---|---|---|---|
| **Critical** | Direct theft or freezing of escrowed/invested funds; bypass of governance timelock; unauthorized `pause`/`unpause`/upgrade | 24 hours | Guardian invokes `governance.pause()` on affected contracts within 24h of confirmation; patch shipped within 7 days |
| **High** | Privilege escalation, authorization bypass short of direct fund loss, incorrect accounting that could lead to loss over time | 48 hours | 14 days |
| **Medium** | Logic bugs with limited blast radius, missing input validation, backend auth gaps not exposing funds | 5 business days | 30 days |
| **Low** | Best-practice deviations, informational findings, non-exploitable issues | 5 business days | Next regular release |

Critical/High reports affecting a live contract trigger our incident
response: the guardian address may call `pause` on the affected contract(s)
per `contracts/governance` (see its module docs for the
pause/upgrade/migrate/unpause sequencing) to halt further exploitation while
a fix is prepared, reviewed, and deployed via the governance timelock.

## Disclosure Policy

We follow coordinated disclosure. Once a fix is deployed (or a mitigation is
in place), we'll agree on a disclosure date with the reporter — typically
within 90 days of the initial report, sooner for critical issues affecting
funds already at risk. Reporters are credited unless they prefer to stay
anonymous.

## Safe Harbor

Good-faith security research consistent with this policy — testing against
testnet, your own accounts, or with explicit permission, and reporting
privately rather than exploiting — will not be treated as a violation of our
terms or result in legal action from us.
