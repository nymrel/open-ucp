# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

Supported development runtimes are Node.js 22/24 and Python 3.11–3.14. Security fixes target those maintained runtime lines.

## Reporting a Vulnerability

The security of autonomous agentic commerce, cryptographic quote signatures, and payment challenges is of paramount importance.

If you discover a security vulnerability within `open-ucp`, please do **not** report it in public GitHub issues. Instead, please follow responsible disclosure:

1. **Email:** Send details directly to `contact@nymrel.com` with the subject `[SECURITY] open-ucp vulnerability report`.
2. **Details:** Include a reproducible proof-of-concept, description of the vulnerability, affected components, and potential impact.
3. **Coordination:** Keep the report private until Nymrel confirms a disclosure plan through the same channel. No fixed response-time SLA is implied by this public repository.

## Cryptographic Standards

* **HMAC-SHA256:** Used by default for quote integrity and x402 payment proof verification.
* **Timing-Safe Equality:** All signature comparisons utilize constant-time comparison (`crypto.timingSafeEqual` in Node.js, `hmac.compare_digest` in Python) to prevent timing attacks.
* **Nonce & Timestamp Checks:** AP2 and X402 payment tokens enforce strict expiration TTLs to eliminate replay attacks.

## Supply-chain controls

- Pull requests are gated by a locked Node install, pinned Python tooling, dependency audits, Ruff, Bandit, cross-platform tests, package-content checks, and CodeQL.
- GitHub Actions are pinned to full commit SHAs and default to read-only repository permissions.
- Registry publication is tag-only and uses short-lived npm/PyPI OIDC identities inside dedicated environments. The workflow contains no long-lived registry write token.
- Local validation, a GitHub build, and an uploaded registry artifact are distinct proof states; do not report a release as published without the completed registry receipts.
