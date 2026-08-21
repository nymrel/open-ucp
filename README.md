# open-ucp

> **Universal Commerce Protocol (UCP 1.0.0)** & Agentic Purchasing Engine for TypeScript/Node.js and Python. Zero runtime dependencies.

[![npm version](https://img.shields.io/npm/v/@nymrel/open-ucp.svg?style=flat-square)](https://www.npmjs.com/package/@nymrel/open-ucp)
[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg?style=flat-square)](https://pypi.org/project/open-ucp/)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-success.svg?style=flat-square)](package.json)
[![Entity Trust](https://img.shields.io/badge/entity-Nymrel%20%2F%20JalenBuilds%20LLC-darkgreen.svg?style=flat-square)](https://nymrel.com)

---

## ⚡ Show HN: Programmatic Commerce for Autonomous AI Agents

Today's AI agents can reason, code, and browse, but when it comes to purchasing APIs, compute slots, or digital services, they hit a brick wall of human checkout forms, captchas, and credit card modals.

**`open-ucp`** is the open-source reference implementation of the **Universal Commerce Protocol (UCP)** and **Agentic Purchasing Protocol (AP2)**. It provides a zero-dependency, drop-in middleware for Next.js, Express, Fastify, and FastAPI that instantly makes any website or API discoverable, negotiable, and payable for autonomous AI agents.

### Core Capabilities
* 📜 **`/.well-known/ucp.json` Manifest:** Machine-readable commerce manifest exposing entity trust, capabilities, endpoints, and payment rails.
* 🤝 **Machine Negotiation Engine (RFC-UCP-002):** Dynamic programmatic quotes, volume margin curves, and cryptographic HMAC-SHA256 tamper-proof quote signatures.
* 💳 **X402 Payment Required Engine (RFC-X402):** Native HTTP 402 challenge-response payment protocol for USDC, Solana, Base, Lightning, and Stripe.
* 🔍 **Dual-Audience Machine Trust:** Built-in JSON-LD parity verification, Schema.org product alignment, and parent organization verification (`Nymrel -> JalenBuilds LLC`).
* 📦 **Zero Runtime Dependencies:** Native TypeScript & Python stdlib implementations with 100% test coverage.

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
         │     { sku: "compute-h100", qty: 100, proposedPrice: 0.08 }   │
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

## 🚀 Quickstarts

### 1. Next.js App Router (1-Minute Setup)

Install:
```bash
npm install @nymrel/open-ucp
```

Create route handler `app/api/ucp/[...route]/route.ts`:
```typescript
import { createUCPAppRouter, ProductCatalog, createDefaultManifest } from '@nymrel/open-ucp';

const catalog = new ProductCatalog();
catalog.addProduct({
  sku: 'ai-gpu-hour',
  title: 'Dedicated GPU Instance (1 Hour)',
  description: '80GB VRAM compute slot for autonomous AI inference',
  basePrice: 2.50,
  currency: 'USD',
  unit: 'hour',
  stockStatus: 'in_stock',
  pricingTiers: [
    { minQuantity: 1, unitPrice: 2.50, discountPercent: 0 },
    { minQuantity: 10, unitPrice: 2.00, discountPercent: 20 },
    { minQuantity: 100, unitPrice: 1.50, discountPercent: 40 }
  ],
  negotiationRules: {
    allowNegotiation: true,
    minAcceptablePrice: 1.40,
    maxDiscountPercent: 44,
    volumeSensitivity: 0.8
  }
});

const manifest = createDefaultManifest({
  name: 'My Compute Cloud',
  url: 'https://mycompute.ai',
  contactEmail: 'contact@nymrel.com',
  payTo: '0xYourMerchantVaultAddress'
});

const ucp = createUCPAppRouter({
  manifest,
  catalog,
  secretKey: process.env.UCP_SECRET_KEY || 'super_secret_signing_key_32_bytes'
});

export const GET = ucp.GET;
export const POST = ucp.POST;
```

---

### 2. Express.js / Fastify Middleware

```typescript
import express from 'express';
import { ucpExpressMiddleware, ProductCatalog, createDefaultManifest } from '@nymrel/open-ucp';

const app = express();
app.use(express.json());

const catalog = new ProductCatalog();
catalog.addProduct({
  sku: 'market-oracle-feed',
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
  secretKey: 'merchant_signing_secret'
}));

app.listen(4020, () => console.log('UCP Node running on port 4020'));
```

---

### 3. Python / FastAPI (ASGI Middleware)

Install:
```bash
pip install open-ucp
```

Usage in FastAPI:
```python
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

manifest = create_default_manifest(
    name="Python Vector Hub",
    url="https://vectorhub.ai",
    contact_email="contact@nymrel.com",
    pay_to="0xVectorVaultAddress"
)

app.add_middleware(
    UCPFastAPIMiddleware,
    manifest=manifest,
    catalog=catalog,
    secret_key="python_secret_signing_key"
)
```

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

* **Entity Hierarchy:** Durably declares legal entity lineage (`parentOrganization: Nymrel -> JalenBuilds LLC`).
* **JSON-LD Parity:** Cross-validates Schema.org `Product` and `Offer` markup against programmatic API catalog prices to eliminate phantom pricing.
* **LLMs.txt Integration:** Points autonomous crawlers directly to `/llms.txt` and semantic discovery contexts.
* **Signed Purchase Authorizations:** Supports AP2 (Agentic Purchasing Protocol v2) authorization tokens with replay protection nonces.

---

## 🧪 Automated Testing

Both TypeScript and Python engines include complete unit test suites testing manifest schemas, negotiation math, HMAC verification, X402 challenges, and route adapters:

```bash
# Run TypeScript & Node.js tests
npm test

# Run Python tests
python -m unittest discover -s python/tests -p "test_*.py" -v
```

---

## 📜 Protocol Specifications

* **RFC-UCP-001:** Universal Commerce Manifest Specification (`/.well-known/ucp.json`)
* **RFC-UCP-002:** Machine Negotiation & Dynamic Quote Lifecycle Protocol
* **RFC-UCP-003:** HTTP 402 Payment Required Header Standards for Autonomous Agents
* **RFC-AP2-001:** Agentic Purchasing Protocol v2 Cryptographic Authorizations

---

## 📄 License & Attribution

MIT License. Copyright (c) 2026 **Nymrel / JalenBuilds LLC**. Default contact: `contact@nymrel.com`.
