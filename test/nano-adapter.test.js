import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  ucpExpressMiddleware, ProductCatalog, createDefaultManifest,
  NegotiationEngine, xnoToRaw, rawToXno, X402PaymentHandler, InMemoryNanoReceiptLedger,
} from '../dist/index.js';

const PAYTO = 'nano_test_merchant';
const SEND = 'A'.repeat(64);
const RECEIVE = 'B'.repeat(64);
const SECRET = 'nano-adapter-regression-secret';
const product = {
  sku: 'MICRO', title: 'Micro', description: 'tiny price', basePrice: 0.00001,
  currency: 'XNO', unit: 'call', stockStatus: 'unlimited',
};
// Default test-only authorization isolates amount/replay cases; security cases override it.
function config(overrides = {}) {
  const manifest = createDefaultManifest({ payTo: PAYTO });
  manifest.paymentRails.x402.defaultNetwork = 'nano';
  manifest.catalogSummary.currency = 'XNO';
  return { manifest, secretKey: SECRET, nanoReceiptLedger: new InMemoryNanoReceiptLedger(), nanoPaymentAuthorizer: () => true, catalog: new ProductCatalog([product]), ...overrides };
}
const lookup = async (hash) => ({
  hash, exists: true, confirmed: true, subtype: hash.toUpperCase() === SEND ? 'send' : 'receive',
  blockAccount: PAYTO, linkAsAccount: PAYTO, sourceHash: SEND,
  amountRaw: xnoToRaw('1'),
});
async function server(t, options) {
  const middleware = ucpExpressMiddleware(options);
  const http = createServer((req, res) => middleware(req, res));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => http.close(resolve)));
  return async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${http.address().port}/api/ucp/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
}
const request = (quantity = 3) => ({ sku: 'MICRO', quantity, agentId: 'agent', clientNonce: 'n' });
const checkout = (quote, txHash = SEND) => ({ quote, paymentProof: { protocol: 'x402', txHash } });

test('HTTP negotiate -> checkout preserves a tiny signed XNO amount exactly', async t => {
  let fulfillment;
  const http = await server(t, config({ nanoRpcLookup: lookup, onCheckoutComplete: data => {
    fulfillment = data; return { delivered: true };
  } }));
  const quote = (await http('negotiate', request())).body;
  assert.equal(quote.totalPrice, '0.00003');
  assert.equal(quote.savings, '0');
  assert.equal(xnoToRaw(quote.totalPrice), '30000000000000000000000000');
  const result = await http('checkout', checkout(quote));
  assert.equal(result.status, 200);
  assert.equal(result.body.amountPaid, '0.00003');
  assert.equal(fulfillment.amount, '0.00003');
  const tampered = await http('checkout', checkout({ ...quote, totalPrice: '0.000030000000000000000000000001' }));
  assert.equal(tampered.status, 422);
});

test('separate HTTP adapters share one atomic ledger for concurrent send/receive claims and restart', async t => {
  const spent = new Map();
  const claims = [];
  let fulfilled = 0;
  const shared = { async claim(id, quoteId) {
    await Promise.resolve();
    claims.push([id, quoteId]);
    if (spent.has(id)) return false;
    spent.set(id, quoteId); return true;
  } };
  const options = config({ nanoRpcLookup: lookup, nanoReceiptLedger: shared,
    onCheckoutComplete: () => { fulfilled++; return {}; } });
  const first = await server(t, options);
  const second = await server(t, options);
  const q1 = (await first('negotiate', request())).body;
  const q2 = (await second('negotiate', request())).body;
  const results = await Promise.all([
    first('checkout', checkout(q1, SEND.toLowerCase())), second('checkout', checkout(q2, RECEIVE)),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 402]);
  assert.equal(fulfilled, 1);
  assert.equal(spent.size, 1);
  assert.ok(claims.every(([id]) => id === SEND));
  // New adapter instance, same retained store: no replay after recreation.
  const restarted = await server(t, options);
  assert.equal((await restarted('checkout', checkout(q1, RECEIVE))).status, 402);
  assert.equal(fulfilled, 1);
});

test('an unavailable shared ledger or unconfirmed RPC never fulfills an HTTP checkout', async t => {
  let fulfilled = 0;
  const http = await server(t, config({ nanoRpcLookup: lookup,
    nanoReceiptLedger: { claim() { throw new Error('store unavailable'); } },
    onCheckoutComplete: () => { fulfilled++; return {}; } }));
  const quote = (await http('negotiate', request())).body;
  assert.equal((await http('checkout', checkout(quote))).status, 402);
  let claims = 0;
  const unconfirmed = await server(t, config({
    nanoRpcLookup: async hash => ({ ...await lookup(hash), confirmed: false }),
    nanoReceiptLedger: { claim() { claims++; return true; } },
    onCheckoutComplete: () => { fulfilled++; return {}; },
  }));
  assert.equal((await unconfirmed('checkout', checkout(quote))).status, 402);
  assert.equal(claims, 0);
  assert.equal(fulfilled, 0);
});

test('XNO totals use integer raw arithmetic for tiers, savings, and fractional raw rejection', () => {
  const engine = new NegotiationEngine({ secretKey: SECRET, payTo: PAYTO, network: 'nano' });
  const quote = engine.createQuote(request(3), { ...product, basePrice: 0.1 });
  assert.equal(quote.totalPrice, '0.3');
  const tiered = engine.createQuote(request(3), { ...product,
    pricingTiers: [{ minQuantity: 2, unitPrice: 0.000009, discountPercent: 10 }] });
  assert.equal(tiered.totalPrice, '0.000027');
  assert.equal(tiered.savings, '0.000003');
  const curve = engine.createQuote({ ...request(10), proposedPrice: 0.000006 }, {
    ...product, negotiationRules: { allowNegotiation: true, minAcceptablePrice: 0.000005,
      maxDiscountPercent: 30, volumeSensitivity: 0.5 }
  });
  assert.ok(Number(curve.totalPrice) > 0);
  assert.equal(engine.verifyQuote(curve).valid, true);
  const raw = engine.createQuote(request(1), { ...product, basePrice: 1e-30 });
  assert.equal(xnoToRaw(raw.totalPrice), '1');
  assert.throws(() => engine.createQuote(request(0.5), { ...product, basePrice: 1e-30 }), /finer/);
  const high = engine.createQuote(request(9), { ...product, basePrice: 0.1234567890123456 });
  assert.equal(high.totalPrice, '1.1111111011111104');
  assert.equal(rawToXno(BigInt(xnoToRaw(high.totalPrice))), high.totalPrice);
  assert.throws(() => xnoToRaw('1e999999999'), /range/);
});

test('shared fixed USD and XNO signatures verify and settlement tampering fails', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/nano-quotes.json', import.meta.url)));
  const engine = new NegotiationEngine({ secretKey: fixtures.secret });
  for (const { quote, signature } of fixtures.cases) {
    assert.equal(engine.signQuotePayload(quote), signature);
    assert.equal(engine.verifyQuote(quote).valid, true);
    assert.equal(engine.verifyQuote({ ...quote, settlementInstructions: {
      ...quote.settlementInstructions, payTo: 'nano_attacker'
    } }).valid, false);
  }
});

test('Nano challenge headers preserve sub-cent precision', () => {
  const handler = new X402PaymentHandler({ secretKey: SECRET, payTo: PAYTO, defaultNetwork: 'nano', defaultCurrency: 'XNO',
    nanoPaymentAuthorizer: () => true, nanoReceiptLedger: new InMemoryNanoReceiptLedger() });
  assert.equal(handler.createChallenge({ amount: 1e-7 }).headers['X-402-Amount'], '0.0000001');
});

test('public receipts cannot claim another invoice or historical deposits, and denial does not burn the payment', async t => {
  const bindings = new Map(); // Registered by a trusted invoice service, never by checkout input.
  const spent = new Map();
  let claims = 0;
  const fulfilled = [];
  const historical = 'C'.repeat(64);
  const options = config({
    nanoRpcLookup: async hash => hash === historical
      ? { ...await lookup(SEND), hash } : lookup(hash),
    nanoPaymentAuthorizer: async payment => {
      assert.equal(payment.payTo, PAYTO);
      assert.equal(payment.block.confirmed, true);
      return bindings.get(payment.paymentId) === payment.quoteId;
    },
    nanoReceiptLedger: { claim(id, quoteId) {
      claims++;
      if (spent.has(id)) return false;
      spent.set(id, quoteId); return true;
    } },
    onCheckoutComplete: data => { fulfilled.push(data.quoteId); return {}; },
  });
  const http = await server(t, options);
  const rightful = (await http('negotiate', request(3))).body;
  const attacker = (await http('negotiate', request(1))).body;
  bindings.set(SEND, rightful.quoteId);
  for (const hash of [SEND.toLowerCase(), RECEIVE, historical]) {
    assert.equal((await http('checkout', checkout(attacker, hash))).status, 402);
  }
  assert.equal(claims, 0);
  assert.deepEqual(fulfilled, []);
  const results = await Promise.all([
    http('checkout', checkout(rightful, SEND.toLowerCase())),
    http('checkout', checkout(rightful, RECEIVE)),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 402]);
  assert.deepEqual(fulfilled, [rightful.quoteId]);
  const restarted = await server(t, options);
  assert.equal((await restarted('checkout', checkout(rightful))).status, 402);
  assert.equal(spent.get(SEND), rightful.quoteId);
});

test('false, non-boolean, or failing Nano authorization never reaches the spent ledger', async t => {
  for (const authorize of [() => false, () => 'true', async () => { throw new Error('invoice service offline'); }]) {
    let claims = 0;
    let fulfilled = false;
    const http = await server(t, config({
      nanoRpcLookup: lookup, nanoPaymentAuthorizer: authorize,
      nanoReceiptLedger: { claim() { claims++; return true; } },
      onCheckoutComplete() { fulfilled = true; return {}; },
    }));
    const quote = (await http('negotiate', request())).body;
    assert.equal((await http('checkout', checkout(quote))).status, 402);
    assert.equal(claims, 0);
    assert.equal(fulfilled, false);
  }
});

test('quantities outside binary64 safe range are never signed, while fractional quantities remain supported', () => {
  const engine = new NegotiationEngine({ secretKey: SECRET });
  for (const quantity of [Number.MAX_SAFE_INTEGER + 1, 1e100]) {
    assert.equal(engine.createQuote(request(quantity), product).status, 'rejected');
  }
  assert.equal(engine.createQuote(request(0.5), product).totalPrice, '0.000005');
  const quote = engine.createQuote(request(Number.MAX_SAFE_INTEGER), product);
  assert.equal(engine.verifyQuote(quote).valid, true);
  assert.equal(engine.verifyQuote({ ...quote, quantity: Number.MAX_SAFE_INTEGER + 1 }).valid, false);
});

test('Nano adapters and challenges refuse missing dependencies before issuing payable instructions', () => {
  for (const overrides of [{ nanoPaymentAuthorizer: undefined }, { nanoReceiptLedger: undefined }]) {
    assert.throws(() => ucpExpressMiddleware(config(overrides)), /Nano requires/);
  }
  const handler = new X402PaymentHandler({ secretKey: SECRET });
  assert.doesNotThrow(() => handler.createChallenge({ amount: 1 }));
  assert.throws(() => handler.createChallenge({ amount: 1, network: 'nano' }), /Nano requires/);
});

test('a non-Nano handler cannot settle Nano without explicit dependencies', async () => {
  const handler = new X402PaymentHandler({ secretKey: SECRET, payTo: PAYTO, nanoRpcLookup: lookup });
  const result = await handler.verifyNanoSettlement({ txHash: SEND, amountXno: 1, quoteId: 'q' });
  assert.equal(result.verified, false);
  assert.match(result.error, /requires/);
});

test('Nano rejects a non-XNO catalog quote before exposing payable instructions', async t => {
  const http = await server(t, config({ catalog: new ProductCatalog([{ ...product, currency: 'USD' }]) }));
  const result = await http('negotiate', request());
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'rejected');
  assert.match(result.body.reason, /XNO/);
  assert.equal(result.body.settlementInstructions.payTo, undefined);
  assert.equal(result.body.settlementInstructions.network, undefined);
  const engine = new NegotiationEngine({ secretKey: SECRET, payTo: PAYTO, network: 'nano' });
  for (const invalid of [{ ...product, stockStatus: 'out_of_stock' }, product]) {
    const quote = engine.createQuote(request(-1), invalid);
    assert.equal(quote.status, 'rejected');
    assert.equal(quote.settlementInstructions.payTo, undefined);
    assert.equal(quote.settlementInstructions.network, undefined);
  }
});

test('Nano challenges reject unsupported currency or destination before payment', () => {
  const handler = new X402PaymentHandler({ secretKey: SECRET, payTo: PAYTO,
    nanoPaymentAuthorizer: () => true, nanoReceiptLedger: new InMemoryNanoReceiptLedger() });
  assert.throws(() => handler.createChallenge({ amount: 1, network: 'nano', currency: 'USD' }), /require XNO/);
  assert.throws(() => handler.createChallenge({ amount: 1, network: 'nano', currency: 'XNO', payTo: '0x0' }), /nano_/);
});
