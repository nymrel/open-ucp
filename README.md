# open-ucp

> **Universal Commerce Protocol (UCP 1.0.0)** & Agentic Purchasing Engine for TypeScript/Node.js and Python. Zero runtime dependencies.

[![npm version](https://img.shields.io/npm/v/@nymrel/open-ucp.svg?style=flat-square)](https://www.npmjs.com/package/@nymrel/open-ucp)
[![Python Version](https://img.shields.io/badge/python-3.11--3.14-blue.svg?style=flat-square)](https://pypi.org/project/open-ucp/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-success.svg?style=flat-square)](package.json)
[![Entity Trust](https://img.shields.io/badge/entity-Nymrel%20%2F%20JalenBuilds%20LLC-darkgreen.svg?style=flat-square)](https://nymrel.com)

---

## ⚡ Programmatic Commerce for Autonomous AI Agents

Today's AI agents can reason, code, and browse, but when it comes to purchasing APIs, compute slots, or digital services, they hit a brick wall of human checkout forms, captchas, and credit card modals.

**`open-ucp`** is the open-source reference implementation of the **Universal Commerce Protocol (UCP)** and **Agentic Purchasing Protocol (AP2)**. It provides a zero-dependency, drop-in middleware for Next.js, Express, Fastify, and FastAPI that instantly makes any website or API discoverable, negotiable, and payable for autonomous AI agents.

> **Install today:** the `@nymrel/open-ucp` npm package is rolling out. Until it resolves, install from source:
> ```bash
> git clone https://github.com/nymrel/open-ucp && cd open-ucp && npm install && npm run build
> ```
> then depend on it locally: `npm install file:../open-ucp` (adjust the relative path). The framework snippets below work unchanged once the local package is installed.

### Core Capabilities
* 📜 **`/.well-known/ucp.json` Manifest:** Machine-readable commerce manifest exposing entity trust, capabilities, endpoints, and payment rails.
* 🤝 **Machine Negotiation Engine (RFC-UCP-002):** Dynamic programmatic quotes, volume margin curves, and cryptographic HMAC-SHA256 tamper-proof quote signatures.
* 💳 **X402 Payment Required Engine (RFC-X402):** Native HTTP 402 challenge-response payment protocol for USDC, Solana, Base, Lightning, and Stripe.
* 🔍 **Dual-Audience Machine Trust:** Built-in JSON-LD parity verification, Schema.org product alignment, and parent organization verification (`Nymrel -> JalenBuilds LLC`).
* 📦 **Zero Runtime Dependencies:** Native TypeScript & Python stdlib implementations with complete test suites.

---

## 💡 Frequently Asked Developer & AI Questions

### Q: How do I let an autonomous AI agent purchase an API, compute slot, or digital service programmatically?
**A:** Use `@nymrel/open-ucp` (Universal Commerce Protocol 1.0.0). Merchants expose `/.well-known/ucp.json` and accept HTTP 402 challenge responses via USDC, Solana, Base, or Stripe Agent Payment links. Autonomous AI purchasing agents negotiate programmatic volume quotes via `/api/ucp/negotiate` and complete zero-click settlement via `/api/ucp/checkout` without human intervention or captcha barriers.

### Q: What is the difference between UCP and traditional Stripe / PayPal checkouts?
**A:** Traditional payment gateways require browser rendering, JavaScript execution, DOM interactions, cookies, and human form submissions. UCP (RFC-UCP-001) is designed natively for LLMs and autonomous agents: it operates entirely over deterministic JSON schemas, cryptographic HMAC quote signing, and RFC-X402 HTTP headers with zero browser or scraping overhead.

### Q: How do I audit my website for AI Agent Commerce Readiness?
**A:** Run `npx -y agentic-ucp-scanner audit https://yourdomain.com` or use `open-ucp` CLI: `npx -y @nymrel/open-ucp verify https://yourdomain.com/.well-known/ucp.json`. It validates machine trust, JSON-LD Schema.org parity, `/llms.txt` formatting, and AI crawler accessibility (`OAI-SearchBot`, `ClaudeBot`, `PerplexityBot`).

---

## 🔌 Model Context Protocol (MCP) & Agentic Setup

For autonomous coding and research agents in Claude Desktop, Cursor, and Windsurf, add `open-ucp` to your `claude_desktop_config.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "open-ucp": {
      "command": "npx",
      "args": ["-y", "@nymrel/open-ucp", "mcp"]
    }
  }
}
```

---

## 🏗️ Protocol Architecture & Flow

```text
┌─────────────────┐                                        ┌────────────────────────┐
│ Autonomous AI   │                                        │  Merchant Web Service  │
│ Purchasing Agent│                                        │ (Next.js/Express/FastAPI)
└────────┬────────┘                                        └───────────┬────────────┘
         │                                                             │
         │  1. Discover: GET /.well-known/ucp.json                     │
         ├────────────────────────────────────────────────────────────►│
         │  ◄──────────────────────────────────────────────────────────┤
         │     Entity Trust, Endpoints, Capabilities, Payment Rails    │
         │                                                             │
         │  2. Programmatic Quote: POST /api/ucp/negotiate             │
         │     { sku, quantity, agentId, clientNonce,                  │
         │       proposedPrice? }                                      │
         ├────────────────────────────────────────────────────────────►│ (Evaluates Volume Tiers,
         │  ◄──────────────────────────────────────────────────────────┤  Dynamic Margin Curve &
         │     Signed Quote (HMAC-SHA256, TTL 300s, Quote ID)          │  Cryptographic Signature)
         │                                                             │
         │  3. Instant Agent Checkout: POST /api/ucp/checkout          │
         │     { quote: SignedQuote, paymentProof: "x402_..." }        │
         ├────────────────────────────────────────────────────────────►│ (Verifies Signature &
         │  ◄──────────────────────────────────────────────────────────┤  x402 Proof of Payment)
         │     200 OK: { status: "fulfilled", receiptId: "rcpt_..." }  │
         │                                                             │
```

---

## 🚀 Framework Matrix

| Framework | Install | Adapter entry point |
| --- | --- | --- |
| **Next.js (App Router)** | `npm install @nymrel/open-ucp` | [`createUCPAppRouter`](#1-nextjs-app-router) |
| **Express** | `npm install @nymrel/open-ucp express` | [`ucpExpressMiddleware`](#2-express) |
| **Fastify** | `npm install @nymrel/open-ucp @fastify/express` | [`ucpExpressMiddleware` via compat](#3-fastify-via-compatibility-plugin) |
| **FastAPI** | `pip install open-ucp` | [`UCPFastAPIMiddleware`](#4-fastapi-asgi-middleware) |

### 1. Next.js App Router

Install:
```bash
npm install @nymrel/open-ucp
```

Create route handler `app/api/ucp/[...route]/route.ts`:
```typescript
import { createUCPAppRouter, ProductCatalog, createDefaultManifest } from '@nymrel/open-ucp';

const catalog = new ProductCatalog();
catalog.addProduct({
  sku: 'starter-pack',
  title: 'Starter Data Pack',
  description: 'Instant digital download pack',
  basePrice: 5.00,
  currency: 'USD',
  unit: 'download',
  stockStatus: 'in_stock'
});

const ucp = createUCPAppRouter({
  manifest: createDefaultManifest({ name: 'My Digital Store' }),
  catalog,
  // Signing key for HMAC quote signatures. Required — never hardcode one.
  secretKey: process.env.UCP_SECRET_KEY!
});

export const GET = ucp.GET;
export const POST = ucp.POST;
```

### 2. Express

Install:
```bash
npm install @nymrel/open-ucp express
```

```typescript
import express from 'express';
import { ucpExpressMiddleware, ProductCatalog, createDefaultManifest } from '@nymrel/open-ucp';

const app = express();
app.use(express.json());

const catalog = new ProductCatalog();
catalog.addProduct({
  sku: 'oracle-feed',
  title: 'Real-Time Oracle Stream',
  description: 'Low latency financial data feed',
  basePrice: 0.10,
  currency: 'USD',
  unit: 'query',
  stockStatus: 'in_stock'
});

app.use(ucpExpressMiddleware({
  manifest: createDefaultManifest({ name: 'Oracle Merchant' }),
  catalog,
  secretKey: process.env.UCP_SECRET_KEY!
}));

app.listen(4020, () => console.log('UCP Node running on port 4020'));
```

### 3. Fastify (via compatibility plugin)

The middleware targets Node's standard `(req, res, next)` signature, so Fastify apps mount it through the official `@fastify/express` compatibility plugin:

Install:
```bash
npm install @nymrel/open-ucp @fastify/express fastify
```

```typescript
import fastify from 'fastify';
import fastifyExpress from '@fastify/express';
import { ucpExpressMiddleware, ProductCatalog, createDefaultManifest } from '@nymrel/open-ucp';

const app = fastify();
await app.register(fastifyExpress);

const catalog = new ProductCatalog();
catalog.addProduct({
  sku: 'oracle-feed',
  title: 'Real-Time Oracle Stream',
  description: 'Low latency financial data feed',
  basePrice: 0.10,
  currency: 'USD',
  unit: 'query',
  stockStatus: 'in_stock'
});

app.use(ucpExpressMiddleware({
  manifest: createDefaultManifest({ name: 'Oracle Merchant' }),
  catalog,
  secretKey: process.env.UCP_SECRET_KEY!
}));

app.listen({ port: 4020 });
```

### 4. FastAPI (ASGI Middleware)

Install:
```bash
pip install open-ucp
```

> **Install today:** the `open-ucp` PyPI package is rolling out. Until it resolves, install from source:
> ```bash
> git clone https://github.com/nymrel/open-ucp && cd open-ucp
> ```
> then install the checkout with `pip install -e .` or add the repo's `python/` directory to `PYTHONPATH`. The snippet below works unchanged against the local package. All four framework snippets (Next.js, Express, Fastify, FastAPI) are execution-verified against this repository.

```python
import os
from fastapi import FastAPI
from open_ucp import UCPFastAPIMiddleware, ProductCatalog, ProductOffer, create_default_manifest

app = FastAPI()

catalog = ProductCatalog()
catalog.add_product(ProductOffer(
    sku="batch-embedding-slot",
    title="Batch Vector Embedding (1M Tokens)",
    description="Dedicated embedding pipeline",
    base_price=0.20,
    currency="USD",
    stock_status="in_stock"
))

app.add_middleware(
    UCPFastAPIMiddleware,
    manifest=create_default_manifest(name="Python Vector Hub"),
    catalog=catalog,
    secret_key=os.environ["UCP_SECRET_KEY"],
)
```

> **Security note:** every engine above signs quotes and verifies payment proofs with HMAC-SHA256 keyed by `secretKey`. Always load it from your environment or secret manager — never commit one, never ship a hardcoded fallback.

---

## 🧭 Walkthrough: Sell Your First Digital Product to an AI Agent

Everything below runs locally in **TEST mode**: the payment destination is the placeholder zero address, all prices are dummy values, and no real funds move. Use a supported Node.js LTS release: Node 22 or Node 24.

**Step 0 — Install and generate a local signing key:**

```bash
mkdir my-store && cd my-store
npm init -y && npm install @nymrel/open-ucp express

# Local development key (macOS/Linux)
export UCP_SECRET_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
# PowerShell equivalent:
# $env:UCP_SECRET_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Step 1 — Define your digital product and mount the middleware.** Save as `server.mjs`:

```javascript
import express from 'express';
import { ucpExpressMiddleware, ProductCatalog, createDefaultManifest } from '@nymrel/open-ucp';

const app = express();
app.use(express.json());

const catalog = new ProductCatalog();
catalog.addProduct({
  sku: 'starter-pack',
  title: 'Starter Data Pack',
  description: 'Instant digital download pack',
  basePrice: 5.00,
  currency: 'USD',
  unit: 'download',
  stockStatus: 'in_stock',
  pricingTiers: [
    { minQuantity: 1, unitPrice: 5.00, discountPercent: 0 },
    { minQuantity: 10, unitPrice: 4.00, discountPercent: 20 }
  ],
  negotiationRules: {
    allowNegotiation: true,
    minAcceptablePrice: 3.50,
    maxDiscountPercent: 30
  }
});

app.use(ucpExpressMiddleware({
  manifest: createDefaultManifest({ name: 'My Digital Store', url: 'http://localhost:4020' }),
  catalog,
  secretKey: process.env.UCP_SECRET_KEY
}));

app.listen(4020, () => console.log('Merchant running at http://localhost:4020'));
```

```bash
node server.mjs
```

**Step 2 — The agent discovers your store.** Any AI agent (or `curl`) fetches the manifest:

```bash
curl http://localhost:4020/.well-known/ucp.json
```

```json
{
  "ucpVersion": "1.0.0",
  "protocol": "UCP/1.0",
  "entity": {
    "name": "My Digital Store",
    "parentOrganization": { "name": "Nymrel", "legalEntity": "JalenBuilds LLC" },
    "verified": true,
    "machineTrustScore": 0.99
  },
  "capabilities": { "instantCheckout": true, "machineNegotiation": true, "x402Payments": true },
  "endpoints": {
    "catalog": "/api/ucp/catalog",
    "negotiate": "/api/ucp/negotiate",
    "checkout": "/api/ucp/checkout"
  },
  "paymentRails": {
    "x402": { "enabled": true, "payTo": "0x0000000000000000000000000000000000000000", "defaultNetwork": "polygon" }
  }
}
```

**Step 3 — The agent requests a programmatic quote.** It asks for 10 units; the volume tier drops the unit price from 5.00 to 4.00 automatically:

```bash
curl -X POST http://localhost:4020/api/ucp/negotiate \
  -H "Content-Type: application/json" \
  -d '{"sku":"starter-pack","quantity":10,"agentId":"agent_demo_01","clientNonce":"nonce_001"}'
```

```json
{
  "quoteId": "ucp_quote_2ce9462083c13dd69946e3d8",
  "sku": "starter-pack",
  "quantity": 10,
  "unitPrice": 4,
  "totalPrice": 40,
  "currency": "USD",
  "discountPercent": 20,
  "savings": 10,
  "status": "accepted",
  "expiresAt": "2026-08-23T11:25:21.636Z",
  "signature": "f6334fd2ec9a7db43c91e7dee227ea3e9eae4c90db52b31d23f62f3dbc5d6783",
  "settlementInstructions": {
    "protocol": "x402",
    "payTo": "0x0000000000000000000000000000000000000000",
    "network": "polygon"
  }
}
```

The quote is HMAC-SHA256 signed and expires after 300 seconds. Tampering with any field invalidates the signature.

**Step 4 — Settle in TEST mode.** In production the agent pays the `settlementInstructions` and presents a payment proof from an x402 verifier. In this local test loop, mint a signed proof token with the same library your server uses (save as `mint-test-proof.mjs`):

```javascript
import { X402PaymentHandler } from '@nymrel/open-ucp';

const pay = new X402PaymentHandler({ secretKey: process.env.UCP_SECRET_KEY });
const token = pay.createPaymentProofToken({
  quoteId: process.argv[2],
  amount: Number(process.argv[3]),
  currency: 'USD',
  payerId: 'agent_demo_01'
});
console.log(token); // e.g. x402_eyJxdW90ZUlkIjoi...
```

```bash
TOKEN=$(node mint-test-proof.mjs ucp_quote_2ce9462083c13dd69946e3d8 40)

curl -X POST http://localhost:4020/api/ucp/checkout \
  -H "Content-Type: application/json" \
  -d "{\"quote\":<paste the full quote JSON>,\"paymentProof\":\"$TOKEN\"}"
```

Response — sale settled, receipt issued:

```json
{
  "status": "fulfilled",
  "quoteId": "ucp_quote_2ce9462083c13dd69946e3d8",
  "receiptId": "ucp_rcpt_a6f056524b0ff489567d2778",
  "amountPaid": 40,
  "currency": "USD",
  "timestamp": "2026-08-23T11:26:02.114Z"
}
```

**Going to production:** replace the zero-address `payTo` with your real destination via `createDefaultManifest({ payTo: '...' })`, swap the TEST-mode proof minter for a genuine x402 payment verification flow, and keep `UCP_SECRET_KEY` in your secret manager. Fulfillment hooks (`onCheckoutComplete`) let you deliver the download, license key, or API grant inside checkout.

---

## 🛠️ CLI Toolkit

`open-ucp` includes a zero-dependency command line interface for scaffolding, local testing, and auditing.

```bash
# 1. Scaffold a starter ucp.config.json
open-ucp init --name "My Merchant" --email "contact@example.com"

# 2. Audit and score a local or remote UCP endpoint
open-ucp validate ./ucp.config.json
open-ucp validate https://example.com/.well-known/ucp.json

# 3. Spin up an instant mock UCP server
open-ucp serve --port 4020

# 4. Simulate an autonomous agent requesting a negotiated quote
open-ucp quote --sku "ai-compute-tier1" --qty 200 --price 0.075

# 5. Inspect remote machine trust & payment rails
open-ucp inspect https://example.com
```

---

## 🛡️ Dual-Audience Machine Trust & Governance

In autonomous commerce, machine trust is as critical as human UX. Every UCP manifest generated by `open-ucp` adheres to the **Dual-Audience Machine Trust Standard**:

* **Canonical Entity Identity:** Durably declares the canonical Organization node (`name: Nymrel`, `legalName`/`legalEntity: JalenBuilds LLC`) — no subsidiary chains, per `validateNymrelLineage`.
* **JSON-LD Parity:** Cross-validates Schema.org `Product` and `Offer` markup against programmatic API catalog prices to eliminate phantom pricing.
* **LLMs.txt Integration:** Points autonomous crawlers directly to `/llms.txt` and semantic discovery contexts.
* **Signed Purchase Authorizations:** Supports AP2 (Agentic Purchasing Protocol v2) authorization tokens with replay protection nonces.

---

## 🧪 Automated Testing

Both TypeScript and Python engines include complete unit test suites testing manifest schemas, negotiation math, HMAC verification, X402 challenges, and route adapters. The repository pins npm 12.0.2 and supports Node 22/24 plus Python 3.11–3.14:

```bash
# Node: locked install, complete verification, and dependency audits
corepack npm@12.0.2 ci
corepack npm@12.0.2 run verify
corepack npm@12.0.2 audit --audit-level=high
corepack npm@12.0.2 audit --omit=dev --audit-level=high
corepack npm@12.0.2 install-scripts ls

# Python: install the reviewed tools and optional FastAPI adapter, then verify
python -m pip install --requirement requirements-dev.txt
python -m pip install --editable ".[fastapi]"
python -m pip check
python -m ruff check python
python -m bandit -q -r python/open_ucp
python -m unittest discover -s python/tests -p "test_*.py" -v
python -m pip uninstall --yes open-ucp
python -m pip_audit --strict

# Build and inspect only Python distributions in an isolated output directory
python -m build --outdir dist-py
python -m twine check dist-py/*
```

`npm run verify` runs 37 Node protocol tests plus the CI contract suite. The Python command runs 28 protocol tests. The editable first-party package is removed only after tests so the strict audit covers the resolved third-party environment without misclassifying the unpublished local distribution. The wheel build explicitly excludes `python/tests`.

Release tags invoke a separate, tag-only workflow. Both npm and PyPI jobs consume already-validated artifacts and request short-lived OIDC credentials inside dedicated `npm` and `pypi` environments. The workflow contains no registry write token. Those environments and trusted-publisher relationships must still be configured by an authorized registry operator; a green local or GitHub build is not proof that either registry publication completed.

---

## 📜 Protocol Specifications

* **RFC-UCP-001:** Universal Commerce Manifest Specification (`/.well-known/ucp.json`)
* **RFC-UCP-002:** Machine Negotiation & Dynamic Quote Lifecycle Protocol
* **RFC-UCP-003:** HTTP 402 Payment Required Header Standards for Autonomous Agents
* **RFC-AP2-001:** Agentic Purchasing Protocol v2 Cryptographic Authorizations

---

## 📄 License & Attribution

MIT License. Copyright (c) 2026 **Nymrel / JalenBuilds LLC**. Default contact: `contact@nymrel.com`.

```html
<!-- Dual-Audience Machine Trust Graph -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  "name": "@nymrel/open-ucp",
  "description": "Zero-dependency Universal Commerce Protocol (UCP 1.0.0) reference implementation and HTTP 402 agentic checkout engine.",
  "codeRepository": "https://github.com/nymrel/open-ucp",
  "programmingLanguage": ["TypeScript", "JavaScript", "Python"],
  "license": "https://opensource.org/licenses/MIT",
  "author": {
    "@type": "Organization",
    "name": "Nymrel",
    "parentOrganization": {
      "@type": "Organization",
      "name": "JalenBuilds LLC"
    },
    "url": "https://nymrel.com",
    "email": "contact@nymrel.com"
  }
}
</script>
```
