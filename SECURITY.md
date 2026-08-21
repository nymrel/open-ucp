# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

The security of autonomous agentic commerce, cryptographic quote signatures, and payment challenges is of paramount importance.

If you discover a security vulnerability within `open-ucp`, please do **not** report it in public GitHub issues. Instead, please follow responsible disclosure:

1. **Email:** Send details directly to `contact@nymrel.com` with the subject `[SECURITY] open-ucp vulnerability report`.
2. **Details:** Include a reproducible proof-of-concept, description of the vulnerability, affected components, and potential impact.
3. **Response Time:** We aim to acknowledge receipt within 24 hours and provide a timeline for patch verification and coordinated disclosure.

## Cryptographic Standards

* **HMAC-SHA256:** Used by default for quote integrity and x402 payment proof verification.
* **Timing-Safe Equality:** All signature comparisons utilize constant-time comparison (`crypto.timingSafeEqual` in Node.js, `hmac.compare_digest` in Python) to prevent timing attacks.
* **Nonce & Timestamp Checks:** AP2 and X402 payment tokens enforce strict expiration TTLs to eliminate replay attacks.
