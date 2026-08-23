/**
 * Test Suite for @nymrel/open-ucp Cloudflare Worker Adapter
 * Tested with node:test & node:assert
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { test, describe } from 'node:test';
import * as assert from 'node:assert';

// The worker adapter is authored in TypeScript. Node >= 22.6 loads it directly
// via --experimental-strip-types (see test/run.mjs); older versions cannot,
// so the suite skips itself instead of failing the whole run.
const worker = await import('../cloudflare/worker.ts').then(
  (m) => m,
  (err) => {
    if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      console.log('# Skipping Cloudflare Worker suite: this Node version cannot load .ts directly (requires >= 22.6).');
      return null;
    }
    throw err;
  }
);

const describeWorker = worker ? describe : describe.skip;

describeWorker('7. Cloudflare Worker Edge Micro-Adapter Tests', () => {
  const { handleRequest } = worker ?? {};
  const env = {
    UCP_SECRET_KEY: 'test_cloudflare_worker_secret_key_12345',
    PAY_TO: '0x71C8F7aD9A208D1767677aB713A7Ef2b72449Fec',
    DEFAULT_NETWORK: 'polygon',
    ENVIRONMENT: 'test',
    UCP_NAME: 'Nymrel Test Worker'
  };

  test('OPTIONS preflight should return 204 with CORS headers', async () => {
    const req = new Request('https://ucp.nymrel.com/api/ucp/manifest.json', {
      method: 'OPTIONS'
    });
    const res = await handleRequest(req, env);
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.ok(res.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
    assert.ok(res.headers.get('X-Machine-Trust')?.includes('Nymrel'));
  });

  test('GET / should return worker info and endpoint directory', async () => {
    const req = new Request('https://ucp.nymrel.com/');
    const res = await handleRequest(req, env);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.protocol, 'UCP/1.0');
    assert.strictEqual(body.status, 'operational');
    assert.strictEqual(body.endpoints.manifest, '/api/ucp/manifest.json');
  });

  test('GET /api/ucp/manifest.json should return compliant UCP manifest with machine trust', async () => {
    const req = new Request('https://ucp.nymrel.com/api/ucp/manifest.json');
    const res = await handleRequest(req, env);
    assert.strictEqual(res.status, 200);
    const manifest = await res.json();
    assert.strictEqual(manifest.ucpVersion, '1.0.0');
    assert.strictEqual(manifest.entity.parentOrganization.name, 'Nymrel');
    assert.strictEqual(manifest.entity.parentOrganization.legalEntity, 'JalenBuilds LLC');
    assert.strictEqual(manifest.capabilities.x402Payments, true);
    assert.strictEqual(manifest.paymentRails.x402.defaultNetwork, 'polygon');
    assert.ok(res.headers.get('X-Machine-Trust')?.includes('trustScore=0.99'));
  });

  test('GET /api/ucp/catalog should return products and JSON-LD parity', async () => {
    const req = new Request('https://ucp.nymrel.com/api/ucp/catalog');
    const res = await handleRequest(req, env);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.protocol, 'UCP/1.0');
    assert.ok(body.count >= 3);
    assert.ok(Array.isArray(body.products));
    assert.ok(Array.isArray(body.jsonLd));
  });

  test('POST /api/ucp/negotiate should generate signed quote with dynamic volume discounts', async () => {
    const req = new Request('https://ucp.nymrel.com/api/ucp/negotiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: 'ai-compute-tier1',
        quantity: 100,
        agentId: 'agent_edge_007',
        clientNonce: 'nonce_edge_1'
      })
    });
    const res = await handleRequest(req, env);
    assert.strictEqual(res.status, 200);
    const quote = await res.json();
    assert.strictEqual(quote.sku, 'ai-compute-tier1');
    assert.strictEqual(quote.quantity, 100);
    assert.strictEqual(quote.unitPrice, 0.085);
    assert.strictEqual(quote.totalPrice, 8.50);
    assert.strictEqual(quote.status, 'accepted');
    assert.ok(quote.signature);
    assert.ok(quote.quoteId.startsWith('ucp_quote_'));
  });

  test('Full sub-second x402 payment and instant checkout settlement loop', async () => {
    // 1. Get Quote
    const quoteReq = new Request('https://ucp.nymrel.com/api/ucp/negotiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: 'edge-subsecond-settlement',
        quantity: 10,
        agentId: 'agent_x402_settler'
      })
    });
    const quoteRes = await handleRequest(quoteReq, env);
    const quote = await quoteRes.json();
    assert.strictEqual(quote.status, 'accepted');
    assert.strictEqual(quote.totalPrice, 4.00);

    // 2. Generate Payment Proof Token via /api/ucp/pay helper
    const payReq = new Request('https://ucp.nymrel.com/api/ucp/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteId: quote.quoteId,
        amount: quote.totalPrice,
        currency: quote.currency,
        payerId: 'agent_x402_settler'
      })
    });
    const payRes = await handleRequest(payReq, env);
    assert.strictEqual(payRes.status, 200);
    const payBody = await payRes.json();
    assert.ok(payBody.token.startsWith('x402_'));

    // 3. Verify Payment Proof via /api/ucp/verify-payment
    const verifyReq = new Request('https://ucp.nymrel.com/api/ucp/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentProof: payBody.token })
    });
    const verifyRes = await handleRequest(verifyReq, env);
    assert.strictEqual(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.strictEqual(verifyBody.verified, true);
    assert.strictEqual(verifyBody.amount, 4.00);

    // 4. Instant Settlement via /api/ucp/checkout
    const checkoutReq = new Request('https://ucp.nymrel.com/api/ucp/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quote,
        paymentProof: payBody.token
      })
    });
    const checkoutRes = await handleRequest(checkoutReq, env);
    assert.strictEqual(checkoutRes.status, 200);
    assert.ok(checkoutRes.headers.get('X-402-Receipt')?.startsWith('ucp_rcpt_'));
    const checkoutBody = await checkoutRes.json();
    assert.strictEqual(checkoutBody.status, 'fulfilled');
    assert.strictEqual(checkoutBody.amountPaid, 4.00);
    assert.strictEqual(checkoutBody.sku, 'edge-subsecond-settlement');
  });

  test('GET /api/ucp/challenge should return HTTP 402 with challenge details', async () => {
    const req = new Request('https://ucp.nymrel.com/api/ucp/challenge?amount=2.50&sku=test_item');
    const res = await handleRequest(req, env);
    assert.strictEqual(res.status, 402);
    assert.strictEqual(res.headers.get('X-402-Amount'), '2.50');
    assert.ok(res.headers.get('WWW-Authenticate')?.includes('X-402 realm="UCP"'));
    const body = await res.json();
    assert.strictEqual(body.error, 'Payment Required');
    assert.strictEqual(body.challenge.amount, 2.50);
  });

  test('GET /api/ucp/health and /llms.txt should succeed', async () => {
    const healthReq = new Request('https://ucp.nymrel.com/api/ucp/health');
    const healthRes = await handleRequest(healthReq, env);
    assert.strictEqual(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.strictEqual(healthBody.status, 'healthy');

    const llmsReq = new Request('https://ucp.nymrel.com/llms.txt');
    const llmsRes = await handleRequest(llmsReq, env);
    assert.strictEqual(llmsRes.status, 200);
    const llmsText = await llmsRes.text();
    assert.ok(llmsText.includes('Universal Commerce Protocol'));
  });
});
