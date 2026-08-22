/**
 * Comprehensive Node.js / TypeScript Test Suite for @nymrel/open-ucp
 * Tested with node:test & node:assert
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  UCPManifestBuilder,
  createDefaultManifest,
  ProductCatalog,
  NegotiationEngine,
  X402PaymentHandler,
  UCPValidator,
  ManifestValidator,
  JsonLdParityValidator,
  AP2ComplianceValidator,
  ucpExpressMiddleware,
  createUCPAppRouter
} from '../dist/index.js';

describe('1. Core Manifest & Entity Trust', () => {
  test('should generate compliant UCP 1.0.0 manifest with Nymrel entity trust', () => {
    const builder = new UCPManifestBuilder();
    const manifest = builder.build();

    assert.strictEqual(manifest.ucpVersion, '1.0.0');
    assert.strictEqual(manifest.protocol, 'UCP/1.0');
    assert.strictEqual(manifest.entity.name, 'Nymrel Platform');
    assert.strictEqual(manifest.entity.parentOrganization.name, 'Nymrel');
    assert.strictEqual(manifest.entity.parentOrganization.legalEntity, 'JalenBuilds LLC');
    assert.strictEqual(manifest.entity.verified, true);
    assert.strictEqual(manifest.capabilities.machineNegotiation, true);
    assert.strictEqual(manifest.capabilities.x402Payments, true);
    assert.ok(manifest.endpoints.catalog);
    assert.ok(manifest.endpoints.negotiate);
    assert.ok(manifest.endpoints.checkout);
  });

  test('createDefaultManifest helper should customize merchant fields', () => {
    const custom = createDefaultManifest({
      name: 'Custom Agent Node',
      url: 'https://agent-node.ai',
      contactEmail: 'contact@nymrel.com',
      payTo: '0x1234567890abcdef1234567890abcdef12345678'
    });

    assert.strictEqual(custom.entity.name, 'Custom Agent Node');
    assert.strictEqual(custom.entity.url, 'https://agent-node.ai');
    assert.strictEqual(custom.paymentRails.x402?.payTo, '0x1234567890abcdef1234567890abcdef12345678');
  });
});

describe('2. Product Catalog & JSON-LD Parity', () => {
  test('should add, search, and export catalog items with Schema.org JSON-LD', () => {
    const catalog = new ProductCatalog();
    catalog.addProduct({
      sku: 'sku-gpu-01',
      title: 'H100 GPU Cluster Slot (1 Hour)',
      description: 'Dedicated GPU inference cluster with 80GB VRAM',
      basePrice: 2.50,
      currency: 'USD',
      unit: 'hour',
      stockStatus: 'in_stock',
      category: 'Compute',
      pricingTiers: [
        { minQuantity: 1, unitPrice: 2.50, discountPercent: 0 },
        { minQuantity: 10, unitPrice: 2.00, discountPercent: 20 },
        { minQuantity: 100, unitPrice: 1.50, discountPercent: 40 }
      ]
    });

    assert.strictEqual(catalog.getAllProducts().length, 1);
    assert.ok(catalog.getProduct('sku-gpu-01'));
    assert.strictEqual(catalog.search('H100').length, 1);
    assert.strictEqual(catalog.getByCategory('Compute').length, 1);

    const summary = catalog.getSummary();
    assert.strictEqual(summary.productCount, 1);
    assert.strictEqual(summary.categories[0], 'Compute');

    const jsonLdList = catalog.exportJsonLdList();
    assert.strictEqual(jsonLdList.length, 1);
    assert.strictEqual(jsonLdList[0]['@type'], 'Product');
    assert.strictEqual(jsonLdList[0]['name'], 'H100 GPU Cluster Slot (1 Hour)');
  });
});

describe('3. Machine Negotiation Engine', () => {
  const secretKey = 'test_secret_negotiation_key_12345';
  const engine = new NegotiationEngine({
    secretKey,
    defaultTtlSeconds: 120,
    payTo: '0xVaultAddress',
    network: 'polygon'
  });

  const product = {
    sku: 'api-feed-01',
    title: 'Market Oracle API',
    description: 'Ultra-low latency price feed',
    basePrice: 1.00,
    currency: 'USD',
    unit: 'call',
    stockStatus: 'in_stock',
    pricingTiers: [
      { minQuantity: 1, unitPrice: 1.00, discountPercent: 0 },
      { minQuantity: 100, unitPrice: 0.80, discountPercent: 20 },
      { minQuantity: 1000, unitPrice: 0.50, discountPercent: 50 }
    ],
    negotiationRules: {
      allowNegotiation: true,
      minAcceptablePrice: 0.40,
      maxDiscountPercent: 60,
      volumeSensitivity: 0.8,
      autoAcceptThreshold: 0.70
    }
  };

  test('should apply volume pricing tier automatically', () => {
    const quote = engine.createQuote(
      { sku: 'api-feed-01', quantity: 150, agentId: 'agent_99', clientNonce: 'n1' },
      product
    );

    assert.strictEqual(quote.status, 'accepted');
    assert.strictEqual(quote.unitPrice, 0.80);
    assert.strictEqual(quote.totalPrice, 120.00);
    assert.strictEqual(quote.discountPercent, 20);
    assert.ok(quote.signature);
  });

  test('should accept proposed price within auto-accept threshold', () => {
    const quote = engine.createQuote(
      { sku: 'api-feed-01', quantity: 50, agentId: 'agent_99', clientNonce: 'n2', proposedPrice: 0.75 },
      product
    );

    assert.strictEqual(quote.status, 'accepted');
    assert.strictEqual(quote.unitPrice, 0.75);
    assert.strictEqual(quote.totalPrice, 37.50);
  });

  test('should counter-offer when proposed price is between floor and auto-accept', () => {
    const quote = engine.createQuote(
      { sku: 'api-feed-01', quantity: 10, agentId: 'agent_99', clientNonce: 'n3', proposedPrice: 0.45 },
      product
    );

    assert.strictEqual(quote.status, 'counter_offer');
    assert.ok(quote.unitPrice >= 0.40);
    assert.ok(quote.reason.includes('Counter-offer'));
  });

  test('should enforce minimum acceptable price floor', () => {
    const quote = engine.createQuote(
      { sku: 'api-feed-01', quantity: 10, agentId: 'agent_99', clientNonce: 'n4', proposedPrice: 0.10 },
      product
    );

    assert.strictEqual(quote.status, 'counter_offer');
    assert.strictEqual(quote.unitPrice, 0.40);
    assert.strictEqual(quote.totalPrice, 4.00);
  });

  test('should cryptographically verify valid quotes and reject tampered ones', () => {
    const quote = engine.createQuote(
      { sku: 'api-feed-01', quantity: 100, agentId: 'agent_99', clientNonce: 'n5' },
      product
    );

    const verifyResult = engine.verifyQuote(quote);
    assert.strictEqual(verifyResult.valid, true);

    // Tamper with price
    const tampered = { ...quote, totalPrice: 1.00 };
    const tamperedResult = engine.verifyQuote(tampered);
    assert.strictEqual(tamperedResult.valid, false);
    assert.strictEqual(tamperedResult.reason, 'Cryptographic signature mismatch on quote');
  });
});

describe('4. X402 Payment Protocol Engine', () => {
  const secretKey = 'test_secret_x402_key_67890';
  const handler = new X402PaymentHandler({
    secretKey,
    payTo: '0xAgentPayToVault',
    defaultNetwork: 'polygon',
    defaultCurrency: 'USD'
  });

  test('should generate RFC-compliant 402 challenge and headers', () => {
    const { challenge, headers } = handler.createChallenge({
      amount: 49.99,
      quoteId: 'ucp_quote_test_01',
      description: 'API query access'
    });

    assert.strictEqual(challenge.amount, 49.99);
    assert.strictEqual(challenge.currency, 'USD');
    assert.strictEqual(headers['X-402-Amount'], '49.99');
    assert.strictEqual(headers['X-402-Pay-To'], '0xAgentPayToVault');
    assert.strictEqual(headers['X-402-Quote-Id'], 'ucp_quote_test_01');
    assert.ok(headers['WWW-Authenticate'].includes('X-402 realm="UCP"'));
  });

  test('should extract authorization headers correctly', () => {
    const token1 = handler.extractPaymentHeader({ 'x-402-authorization': 'x402_abc123' });
    assert.strictEqual(token1, 'x402_abc123');

    const token2 = handler.extractPaymentHeader({ 'authorization': 'X-402 x402_def456' });
    assert.strictEqual(token2, 'x402_def456');

    const token3 = handler.extractPaymentHeader({ 'authorization': 'Bearer x402_ghi789' });
    assert.strictEqual(token3, 'x402_ghi789');
  });

  test('should create and verify signed payment proof tokens', () => {
    const token = handler.createPaymentProofToken({
      quoteId: 'ucp_quote_100',
      amount: 25.00,
      currency: 'USD',
      payerId: 'agent_buyer_01'
    });

    assert.ok(token.startsWith('x402_'));

    const verification = handler.verifyPayment(token);
    assert.strictEqual(verification.verified, true);
    assert.strictEqual(verification.amount, 25.00);
    assert.strictEqual(verification.currency, 'USD');
    assert.strictEqual(verification.payerId, 'agent_buyer_01');
    assert.ok(verification.receiptId?.startsWith('ucp_rcpt_'));
  });

  test('should reject invalid or expired payment tokens', () => {
    const invalidToken = 'x402_invalid_base64_blob';
    const res = handler.verifyPayment(invalidToken);
    assert.strictEqual(res.verified, false);

    const expiredToken = handler.createPaymentProofToken({
      quoteId: 'ucp_quote_100',
      amount: 25.00,
      currency: 'USD',
      payerId: 'agent_buyer_01',
      expiresAt: new Date(Date.now() - 10000).toISOString()
    });

    const expRes = handler.verifyPayment(expiredToken);
    assert.strictEqual(expRes.verified, false);
    assert.strictEqual(expRes.error, 'Payment proof token has expired');
  });
});

describe('5. Validator Suite & AP2 Compliance', () => {
  test('should validate manifest and generate compliance report', () => {
    const manifest = createDefaultManifest();
    const report = UCPValidator.validate({ manifest });

    assert.strictEqual(report.valid, true);
    assert.ok(report.score >= 90);
    assert.strictEqual(report.details.manifestSchema, true);
    assert.strictEqual(report.details.parentOrgVerified, true);
    assert.strictEqual(report.details.endpointsFunctional, true);
  });

  test('should flag invalid manifest schema', () => {
    const broken = { ucpVersion: '1.0.0' }; // missing entity, endpoints, etc.
    const report = UCPValidator.validate({ manifest: broken });

    assert.strictEqual(report.valid, false);
    assert.ok(report.issues.length > 0);
  });

  test('should validate AP2 payloads correctly', () => {
    const validAp2 = {
      version: '2.0',
      agentId: 'agent_nymrel_01',
      authority: 'nymrel.auth',
      nonce: 'random_nonce_12345',
      timestamp: new Date().toISOString(),
      signature: 'valid_crypto_signature_hex_string_32_bytes'
    };

    const res = AP2ComplianceValidator.validate(validAp2);
    assert.strictEqual(res.valid, true);

    const invalidAp2 = { version: '1.0' };
    const badRes = AP2ComplianceValidator.validate(invalidAp2);
    assert.strictEqual(badRes.valid, false);
  });
});

describe('6. Next.js App Router Adapter', () => {
  test('createUCPAppRouter should handle GET /.well-known/ucp.json and POST /api/ucp/negotiate', async () => {
    const manifest = createDefaultManifest();
    const catalog = new ProductCatalog();
    catalog.addProduct({
      sku: 'test-sku',
      title: 'Test Service',
      description: 'Automated test service',
      basePrice: 10.00,
      currency: 'USD',
      unit: 'call',
      stockStatus: 'in_stock'
    });

    const router = createUCPAppRouter({
      manifest,
      catalog,
      secretKey: 'test_key_router'
    });

    // 1. GET Manifest
    const reqGet = new Request('http://localhost:3000/.well-known/ucp.json');
    const resGet = await router.GET(reqGet);
    assert.strictEqual(resGet.status, 200);
    const manifestBody = await resGet.json();
    assert.strictEqual(manifestBody.ucpVersion, '1.0.0');

    // 2. POST Negotiate
    const reqPost = new Request('http://localhost:3000/api/ucp/negotiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: 'test-sku',
        quantity: 5,
        agentId: 'agent_nextjs'
      })
    });
    const resPost = await router.POST(reqPost);
    assert.strictEqual(resPost.status, 200);
    const quoteBody = await resPost.json();
    assert.strictEqual(quoteBody.sku, 'test-sku');
    assert.strictEqual(quoteBody.totalPrice, 50.00);
    assert.strictEqual(quoteBody.status, 'accepted');
  });
});

describe('7. Canonical Origin Verification', () => {
  const base = createDefaultManifest();

  function validateMutation(mutate) {
    const manifest = JSON.parse(JSON.stringify(base));
    mutate(manifest);
    return ManifestValidator.validate(manifest);
  }

  function issuePaths(res) {
    return res.issues.map(i => i.path);
  }

  test('accepts default manifest with relative endpoints and public HTTPS entity URL', () => {
    const res = ManifestValidator.validate(JSON.parse(JSON.stringify(base)));
    assert.strictEqual(res.valid, true);
    const paths = issuePaths(res);
    assert.ok(!paths.includes('entity.url'));
    assert.ok(!paths.some(p => p.startsWith('endpoints.')));
    assert.ok(!paths.includes('llmsTxtUrl'));
  });

  test('accepts same-origin absolute HTTPS endpoint URLs', () => {
    const res = validateMutation(m => {
      m.endpoints.catalog = 'https://nymrel.com/api/ucp/catalog';
      m.llmsTxtUrl = 'https://nymrel.com/llms.txt';
    });
    assert.strictEqual(res.valid, true);
  });

  test('rejects non-HTTPS entity URLs', () => {
    const res = validateMutation(m => { m.entity.url = 'http://nymrel.com'; });
    assert.strictEqual(res.valid, false);
    assert.ok(issuePaths(res).includes('entity.url'));
  });

  test('rejects loopback and private-network entity URLs', () => {
    for (const url of ['https://localhost', 'http://127.0.0.1:8080', 'https://192.168.1.10', 'https://10.0.0.7']) {
      const res = validateMutation(m => { m.entity.url = url; });
      assert.strictEqual(res.valid, false, `expected rejection for ${url}`);
      assert.ok(issuePaths(res).includes('entity.url'), `expected entity.url issue for ${url}`);
    }
  });

  test('rejects credential-bearing entity URLs', () => {
    const res = validateMutation(m => { m.entity.url = 'https://user:pass@nymrel.com'; });
    assert.strictEqual(res.valid, false);
    assert.ok(issuePaths(res).includes('entity.url'));
  });

  test('rejects cross-origin endpoint URLs', () => {
    const res = validateMutation(m => { m.endpoints.checkout = 'https://evil.example.com/api/ucp/checkout'; });
    assert.strictEqual(res.valid, false);
    assert.ok(issuePaths(res).includes('endpoints.checkout'));
  });

  test('rejects HTTP machine-action URLs', () => {
    const res = validateMutation(m => {
      m.endpoints.negotiate = 'http://nymrel.com/api/ucp/negotiate';
      m.llmsTxtUrl = 'http://nymrel.com/llms.txt';
    });
    assert.strictEqual(res.valid, false);
    const paths = issuePaths(res);
    assert.ok(paths.includes('endpoints.negotiate'));
    assert.ok(paths.includes('llmsTxtUrl'));
  });

  test('rejects credential-bearing and malformed endpoint URLs', () => {
    const cred = validateMutation(m => { m.endpoints.catalog = 'https://agent:secret@nymrel.com/api/ucp/catalog'; });
    assert.strictEqual(cred.valid, false);
    assert.ok(issuePaths(cred).includes('endpoints.catalog'));

    const malformed = validateMutation(m => { m.endpoints.catalog = 'api/ucp/catalog'; });
    assert.strictEqual(malformed.valid, false);
    assert.ok(issuePaths(malformed).includes('endpoints.catalog'));

    const protoRelative = validateMutation(m => { m.endpoints.catalog = '//cdn.example.com/api/ucp/catalog'; });
    assert.strictEqual(protoRelative.valid, false);
    assert.ok(issuePaths(protoRelative).includes('endpoints.catalog'));
  });

  test('rejects cross-origin llmsTxtUrl', () => {
    const res = validateMutation(m => { m.llmsTxtUrl = 'https://docs.example.net/llms.txt'; });
    assert.strictEqual(res.valid, false);
    assert.ok(issuePaths(res).includes('llmsTxtUrl'));
  });
});
