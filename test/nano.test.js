/**
 * Nano (XNO) Settlement Verification - test suite for @nymrel/open-ucp
 * Uses an injected mock RPC lookup so the tests are deterministic and need no
 * live network (mirrors how the merchant would wire a real node in production).
 *
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */
import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { X402PaymentHandler, xnoToRaw, verifyNanoReceipt } from '../dist/index.js';

const PAYTO = 'nano_3f3r9t6r8n7y5d1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7';
const BLOCK = '0'.repeat(64);

/** Build a mock RPC lookup that returns a synthetic block_info payload. */
function mockLookup(payload) {
  return async () => payload;
}

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
});

describe('verifyNanoReceipt (chain-state verification)', () => {
  test('accepts a receive block on the pay-to account with enough amount', async () => {
    const lookup = mockLookup({
      exists: true,
      subtype: 'receive',
      account: PAYTO,
      amountRaw: (10n ** 26n).toString(), // 0.0001 XNO
    });
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), lookup);
    assert.strictEqual(res.verified, true);
  });

  test('accepts a send block on the pay-to account (merchant-side intake)', async () => {
    const lookup = mockLookup({
      exists: true,
      subtype: 'send',
      account: PAYTO,
      amountRaw: (10n ** 25n).toString(),
    });
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), lookup);
    assert.strictEqual(res.verified, true);
  });

  test('rejects a block whose account is not the pay-to (wrong beneficiary)', async () => {
    const lookup = mockLookup({
      exists: true,
      subtype: 'receive',
      account: 'nano_1111111111111111111111111111111111111111111111111111hifc8npp',
      amountRaw: (10n ** 25n).toString(),
    });
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), lookup);
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /pay-to/);
  });

  test('rejects an amount below the expected price', async () => {
    const lookup = mockLookup({
      exists: true,
      subtype: 'receive',
      account: PAYTO,
      amountRaw: (10n ** 20n).toString(), // far below
    });
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), lookup);
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /below expected/);
  });

  test('rejects a non-settlement subtype (e.g. change)', async () => {
    const lookup = mockLookup({
      exists: true,
      subtype: 'change',
      account: PAYTO,
      amountRaw: (10n ** 25n).toString(),
    });
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), lookup);
    assert.strictEqual(res.verified, false);
  });

  test('rejects a block that does not exist on the public chain', async () => {
    const lookup = mockLookup(null);
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), lookup);
    assert.strictEqual(res.verified, false);
    assert.match(res.reason, /not found/);
  });

  test('rejects an unreadable node answer (RPC error) — fail closed', async () => {
    const lookup = async () => null;
    const res = await verifyNanoReceipt(BLOCK, PAYTO, xnoToRaw(0.00001), lookup);
    assert.strictEqual(res.verified, false);
  });

  test('rejects a malformed block hash', async () => {
    const res = await verifyNanoReceipt('not-a-hash', PAYTO, xnoToRaw(0.00001), mockLookup({}));
    assert.strictEqual(res.verified, false);
  });
});

describe('X402PaymentHandler nano network coordinate', () => {
  test('createChallenge on the nano network emits a nano_ pay-to and X-402-Network: nano', () => {
    const handler = new X402PaymentHandler({
      secretKey: 'k',
      payTo: PAYTO,
      defaultNetwork: 'nano',
      defaultCurrency: 'XNO',
      nanoRpcLookup: mockLookup(null),
    });
    const { challenge, headers } = handler.createChallenge({
      amount: 0.00001,
      network: 'nano',
    });
    assert.ok(challenge.payTo.startsWith('nano_'));
    assert.strictEqual(headers['X-402-Network'], 'nano');
    assert.match(headers['WWW-Authenticate'], /nano/);
  });
});

describe('verifyNanoSettlement (handler end-to-end)', () => {
  test('verifies a valid on-chain receipt to XNO', async () => {
    const handler = new X402PaymentHandler({
      secretKey: 'k',
      payTo: PAYTO,
      defaultNetwork: 'nano',
      defaultCurrency: 'XNO',
      nanoRpcLookup: mockLookup({
        exists: true,
        subtype: 'receive',
        account: PAYTO,
        amountRaw: (10n ** 25n).toString(),
      }),
    });
    const res = await handler.verifyNanoSettlement({
      txHash: BLOCK,
      amountXno: 0.00001,
    });
    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.currency, 'XNO');
    assert.match(res.receiptId, /^ucp_nano_/);
  });

  test('rejects when the configured pay-to is not a nano_ address', async () => {
    const handler = new X402PaymentHandler({
      secretKey: 'k',
      payTo: '0x0000000000000000000000000000000000000000',
    });
    const res = await handler.verifyNanoSettlement({
      txHash: BLOCK,
      amountXno: 0.00001,
    });
    assert.strictEqual(res.verified, false);
  });

  test('rejects an on-chain block that does not match (fail closed)', async () => {
    const handler = new X402PaymentHandler({
      secretKey: 'k',
      payTo: PAYTO,
      defaultNetwork: 'nano',
      nanoRpcLookup: mockLookup({ exists: true, subtype: 'receive', account: 'nano_other', amountRaw: (10n ** 25n).toString() }),
    });
    const res = await handler.verifyNanoSettlement({
      txHash: BLOCK,
      amountXno: 0.00001,
    });
    assert.strictEqual(res.verified, false);
  });
});
