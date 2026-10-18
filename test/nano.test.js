/**
 * Nano (XNO) Settlement Verification - test suite for @nymrel/open-ucp
 * Uses an injected mock RPC lookup so the tests are deterministic and need no
 * live network (mirrors how the merchant would wire a real node in production).
 *
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */
import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  X402PaymentHandler, NegotiationEngine, xnoToRaw, verifyNanoReceipt, InMemoryNanoReceiptLedger,
} from '../dist/index.js';

const PAYTO = 'nano_3f3r9t6r8n7y5d1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7';
const OTHER = 'nano_1111111111111111111111111111111111111111111111111111hifc8npp';
const BLOCK = '0'.repeat(64);
const BLOCK2 = '1'.repeat(64);
const SOURCE = 'A'.repeat(64);

/** Build a mock RPC lookup that returns a synthetic block_info payload. */
function mockLookup(payload) {
  return async () => payload;
}

/** A confirmed receive that credits `account`, pocketing the send `source`. */
const receiveTo = (account, raw = 10n ** 25n, source = SOURCE) => ({
  exists: true, confirmed: true, subtype: 'receive',
  blockAccount: account, amountRaw: raw.toString(), sourceHash: source,
});

/** A confirmed send FROM `from` TO `to`. */
const sendTo = (from, to, raw = 10n ** 25n) => ({
  exists: true, confirmed: true, subtype: 'send',
  blockAccount: from, linkAsAccount: to, amountRaw: raw.toString(),
});

// Test-only authorizer isolates chain/replay checks. HTTP tests use trusted invoice bindings.
const nanoHandler = (lookup, opts = {}) => new X402PaymentHandler({
  secretKey: 'k', payTo: PAYTO, defaultNetwork: 'nano', defaultCurrency: 'XNO',
  nanoRpcLookup: lookup, nanoReceiptLedger: new InMemoryNanoReceiptLedger(), nanoPaymentAuthorizer: () => true, ...opts,
});

describe('xnoToRaw (unit conversion)', () => {
  test('0.00001 XNO is 10^25 raw', () => {
    assert.strictEqual(xnoToRaw(0.00001), (10n ** 25n).toString());
  });
  test('1 XNO is 10^30 raw', () => {
    assert.strictEqual(xnoToRaw(1), (10n ** 30n).toString());
  });
  test('negative amounts are refused', () => {
    assert.throws(() => xnoToRaw(-1));
  });

  // Regression: String(1e-7) is "1e-7", not "0.0000001". Reading that as a plain
  // decimal produced "1e-7" + 30 zeros and BigInt() threw, so every amount below
  // 1e-6 XNO - the sub-cent settlement this rail exists for - was unquotable.
  test('amounts JavaScript prints in exponent form convert exactly', () => {
    assert.strictEqual(xnoToRaw(1e-7), (10n ** 23n).toString());
    assert.strictEqual(xnoToRaw(1e-8), (10n ** 22n).toString());
    assert.strictEqual(xnoToRaw(5e-7), (5n * 10n ** 23n).toString());
    assert.strictEqual(xnoToRaw(1e21), (10n ** 51n).toString());
  });
  test('1 raw is the smallest representable amount', () => {
    assert.strictEqual(xnoToRaw('0.000000000000000000000000000001'), '1');
  });
  // Regression: padEnd(30) left an over-long fraction in place, so a 35-digit
  // fraction silently produced a 10^5-times-too-large raw amount.
  test('an amount finer than 1 raw is refused, never truncated', () => {
    assert.throws(() => xnoToRaw('0.' + '1'.repeat(35)), /finer than 1 raw/);
  });
  test('trailing zeros beyond 1 raw are harmless', () => {
    assert.strictEqual(xnoToRaw('0.5' + '0'.repeat(35)), (5n * 10n ** 29n).toString());
  });
  test('a string amount a double cannot hold is exact', () => {
    assert.strictEqual(
      xnoToRaw('1.000000000000000000000000000001'),
      (10n ** 30n + 1n).toString()
    );
  });
  test('non-numeric input is refused', () => {
    assert.throws(() => xnoToRaw('abc'));
    assert.throws(() => xnoToRaw('.'));
    assert.throws(() => xnoToRaw(''));
    assert.throws(() => xnoToRaw(NaN));
    assert.throws(() => xnoToRaw(Infinity));
  });
});

describe('verifyNanoReceipt (chain-state verification)', () => {
  test('accepts a receive block ON the pay-to account', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(receiveTo(PAYTO, 10n ** 26n)));
    assert.strictEqual(res.verified, true);
  });

  test('accepts a send block whose DESTINATION is the pay-to account', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(sendTo(OTHER, PAYTO)));
    assert.strictEqual(res.verified, true);
  });

  // Regression, authentication bypass: `block_account` on a send is the PAYER.
  // Accepting a send because block_account === payTo accepted the merchant's own
  // outgoing payments - all public - as proof that a stranger had paid.
  test('rejects a send block FROM the pay-to account (the merchant paying out)', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(sendTo(PAYTO, OTHER, 50n * 10n ** 30n)));
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /credit the expected pay-to/);
  });

  test('rejects a receive block on somebody else account (wrong beneficiary)', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(receiveTo(OTHER)));
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /credit the expected pay-to/);
  });

  // Regression, fail-open: the payee check was `if (info.account && ...)`, so a
  // node answer that carried no account skipped the check altogether.
  test('rejects a block whose payee field the node did not report', async () => {
    const noAccount = { exists: true, confirmed: true, subtype: 'receive', amountRaw: (10n ** 30n).toString() };
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(noAccount));
    assert.strictEqual(res.verified, false);
    const noDest = { exists: true, confirmed: true, subtype: 'send', blockAccount: OTHER, amountRaw: (10n ** 30n).toString() };
    const res2 = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(noDest));
    assert.strictEqual(res2.verified, false);
  });

  test('rejects a receive whose source send the node did not report', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(receiveTo(PAYTO, 10n ** 26n, null)));
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /no source send/);
  });

  test('a send and its receive verify to the same payment id', async () => {
    const send = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(sendTo(OTHER, PAYTO)));
    const recv = await verifyNanoReceipt(BLOCK2, PAYTO, xnoToRaw(0.00001), mockLookup(receiveTo(PAYTO, 10n ** 25n, BLOCK)));
    assert.ok(send.paymentId);
    assert.strictEqual(send.paymentId, recv.paymentId);
  });

  test('rejects a block the node has not confirmed yet', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup({ ...receiveTo(PAYTO), confirmed: false }));
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /not confirmed/);
  });

  test('rejects an amount below the expected price', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(receiveTo(PAYTO, 10n ** 20n)));
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /below expected/);
  });

  test('rejects a non-integer raw amount instead of throwing', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup({ ...receiveTo(PAYTO), amountRaw: '1.5' }));
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /not an integer raw/);
  });

  test('rejects a non-settlement subtype (e.g. change)', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup({ ...receiveTo(PAYTO), subtype: 'change' }));
    assert.strictEqual(res.verified, false);
  });

  test('rejects a block that does not exist on the public chain', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), mockLookup(null));
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /not found/);
  });

  test('rejects an unreadable node answer (RPC error) — fail closed', async () => {
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), async () => null);
    assert.strictEqual(res.verified, false);
  });

  test('rejects a malformed block hash', async () => {
    const res = await verifyNanoReceipt('not-a-hash', PAYTO, xnoToRaw(0.00001), mockLookup({}));
    assert.strictEqual(res.verified, false);
  });
});

describe('X402PaymentHandler nano network coordinate', () => {
  test('createChallenge on the nano network emits a nano_ pay-to and X-402-Network: nano', () => {
    const handler = nanoHandler(mockLookup(null));
    const { challenge, headers } = handler.createChallenge({ amount: 0.00001, network: 'nano' });
    assert.ok(challenge.payTo.startsWith('nano_'));
    assert.strictEqual(headers['X-402-Network'], 'nano');
    assert.match(headers['WWW-Authenticate'], /nano/);
  });
});

describe('verifyNanoSettlement (handler end-to-end)', () => {
  const settle = (handler, over = {}) => handler.verifyNanoSettlement({
    txHash: BLOCK, amountXno: 0.00001, quoteId: 'ucp_quote_1', currency: 'XNO', ...over,
  });

  test('verifies a valid on-chain receipt to XNO', async () => {
    const res = await settle(nanoHandler(mockLookup(receiveTo(PAYTO))));
    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.currency, 'XNO');
    assert.match(res.receiptId, /^ucp_nano_/);
  });

  // Regression, replay: nothing recorded which block had already been spent, so
  // one genuine receive confirmed every later order at or below its amount.
  test('a block that already settled an order is refused a second time', async () => {
    const handler = nanoHandler(mockLookup(receiveTo(PAYTO)));
    assert.strictEqual((await settle(handler, { quoteId: 'q1' })).verified, true);
    const second = await settle(handler, { quoteId: 'q2' });
    assert.strictEqual(second.verified, false);
    assert.match(second.error, /already settled/);
  });

  // Regression, double settlement: a payment is two blocks (the payer's send and
  // the merchant's receive), both crediting the pay-to. Keying the ledger on the
  // presented hash let one payment settle one order per block.
  test('one payment presented as its send and then its receive settles once', async () => {
    const blocks = {
      [BLOCK]: sendTo(OTHER, PAYTO),
      [BLOCK2]: receiveTo(PAYTO, 10n ** 25n, BLOCK),
    };
    const handler = nanoHandler(async (hash) => blocks[hash]);
    assert.strictEqual((await settle(handler, { txHash: BLOCK, quoteId: 'q1' })).verified, true);
    const second = await settle(handler, { txHash: BLOCK2, quoteId: 'q2' });
    assert.strictEqual(second.verified, false);
    assert.match(second.error, /already settled/);
  });

  test('one payment presented as its receive and then its send settles once', async () => {
    const blocks = {
      [BLOCK]: sendTo(OTHER, PAYTO),
      [BLOCK2]: receiveTo(PAYTO, 10n ** 25n, BLOCK.toLowerCase()),
    };
    const handler = nanoHandler(async (hash) => blocks[hash]);
    assert.strictEqual((await settle(handler, { txHash: BLOCK2, quoteId: 'q1' })).verified, true);
    const second = await settle(handler, { txHash: BLOCK, quoteId: 'q2' });
    assert.strictEqual(second.verified, false);
    assert.match(second.error, /already settled/);
  });

  test('a failed verification does not burn the block hash', async () => {
    const handler = nanoHandler(mockLookup(receiveTo(PAYTO, 1n)));
    assert.strictEqual((await settle(handler)).verified, false);
    const handler2 = nanoHandler(mockLookup(receiveTo(PAYTO)));
    assert.strictEqual((await settle(handler2)).verified, true);
  });

  test('two different payments settle two different orders', async () => {
    const handler = nanoHandler(mockLookup(sendTo(OTHER, PAYTO)));
    assert.strictEqual((await settle(handler, { txHash: BLOCK, quoteId: 'q1' })).verified, true);
    assert.strictEqual((await settle(handler, { txHash: BLOCK2, quoteId: 'q2' })).verified, true);
  });

  // Regression, denomination: totalPrice is in the quote's own currency, and it
  // was handed to the XNO rail as though it were already XNO.
  test('a total denominated in anything but XNO is refused', async () => {
    const res = await settle(nanoHandler(mockLookup(receiveTo(PAYTO))), { currency: 'USD' });
    assert.strictEqual(res.verified, false);
    assert.match(res.error, /must be quoted in XNO/);
  });

  test('a settlement must name the quote it settles', async () => {
    const res = await settle(nanoHandler(mockLookup(receiveTo(PAYTO))), { quoteId: '' });
    assert.strictEqual(res.verified, false);
  });

  test('a zero amount is refused', async () => {
    const res = await settle(nanoHandler(mockLookup(receiveTo(PAYTO))), { amountXno: 0 });
    assert.strictEqual(res.verified, false);
  });

  test('rejects when the configured pay-to is not a nano_ address', async () => {
    const handler = new X402PaymentHandler({ secretKey: 'k', payTo: '0x' + '0'.repeat(40) });
    const res = await settle(handler);
    assert.strictEqual(res.verified, false);
  });

  test('rejects an on-chain block that does not match (fail closed)', async () => {
    const res = await settle(nanoHandler(mockLookup(receiveTo(OTHER))));
    assert.strictEqual(res.verified, false);
  });

  test('a lookup that throws is a rejection, not a crash, and frees the hash', async () => {
    const boom = nanoHandler(async () => { throw new Error('node unreachable'); });
    const res = await settle(boom);
    assert.strictEqual(res.verified, false);
    assert.match(res.error, /lookup failed/);
  });
});

// Regression, authentication bypass: settlementInstructions sat OUTSIDE the
// signed payload, so a payer could rewrite payTo to an account they control,
// pay themselves, and present a still-valid signature.
describe('quote signature covers the settlement instructions', () => {
  const engine = () => new NegotiationEngine({
    secretKey: 'merchant-secret', payTo: PAYTO, network: 'nano',
  });
  const product = {
    sku: 'WIDGET', name: 'Widget', description: 'w',
    basePrice: 5, currency: 'XNO', stockStatus: 'in_stock',
  };
  const quote = () => engine().createQuote({ sku: 'WIDGET', quantity: 1, agentId: 'a', clientNonce: 'n' }, product);

  test('an untouched quote still verifies', () => {
    assert.strictEqual(engine().verifyQuote(quote()).valid, true);
  });

  test('rewriting the pay-to invalidates the quote', () => {
    const q = quote();
    q.settlementInstructions.payTo = OTHER;
    const res = engine().verifyQuote(q);
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /signature/i);
  });

  test('rewriting the settlement network invalidates the quote', () => {
    const q = quote();
    q.settlementInstructions.network = 'nano-testnet';
    assert.strictEqual(engine().verifyQuote(q).valid, false);
  });

  test('rewriting the settlement protocol invalidates the quote', () => {
    const q = quote();
    q.settlementInstructions.protocol = 'direct';
    assert.strictEqual(engine().verifyQuote(q).valid, false);
  });

  test('removing the settlement instructions invalidates the quote', () => {
    const q = quote();
    delete q.settlementInstructions;
    assert.strictEqual(engine().verifyQuote(q).valid, false);
  });
});
