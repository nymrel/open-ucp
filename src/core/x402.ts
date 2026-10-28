/**
 * Universal Commerce Protocol (UCP) - X402 Payment Required Handler
 * Native, zero-dependency implementation of RFC-X402 and AP2 HTTP Payment Protocol
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import * as crypto from 'node:crypto';
import { X402Challenge, PaymentProof, PaymentVerificationResult } from './types.js';
import { NanoRpcLookup, NanoPaymentAuthorizer, defaultNanoRpcLookup, verifyNanoReceipt, xnoToRaw, rawToXno } from './nano.js';

/**
 * One Nano payment settles ONE order. A block hash is public and permanent, so
 * without this ledger a single genuine receive confirms every later order at or
 * below its amount, forever. The key is the payment id from verifyNanoReceipt
 * (the send block's hash), so a payment presented once as its send and once as
 * the merchant's receive is still one payment.
 */
export interface NanoReceiptLedger {
  /**
   * Atomically claim a payment id for one order. Returns false when it has
   * already settled an order - that is a replay and must be rejected.
   * An implementation spanning processes must make this ONE atomic operation
   * (a unique-index insert, Redis SETNX): a has()-then-add() pair lets two
   * concurrent requests settle on the same block.
   */
  claim(blockHash: string, quoteId: string): Promise<boolean> | boolean;
  /**
   * Not called by the handler any more (it claims only after a block verifies);
   * kept optional so existing ledgers that implement it still type-check.
   */
  release?(blockHash: string): Promise<void> | void;
}

/**
 * Development-only in-process ledger. Production merchants MUST pass a durable
 * shared store, including a single worker that may restart, or payments replay
 * after restart or once per process. This ledger does not authorize invoice binding.
 */
export class InMemoryNanoReceiptLedger implements NanoReceiptLedger {
  private spent = new Map<string, string>();
  public claim(blockHash: string, quoteId: string): boolean {
    const key = blockHash.toUpperCase();
    if (this.spent.has(key)) return false;
    this.spent.set(key, quoteId);
    return true;
  }
  public release(blockHash: string): void {
    this.spent.delete(blockHash.toUpperCase());
  }
}

export interface X402Options {
  secretKey: string;
  payTo?: string;
  defaultNetwork?: string;
  defaultCurrency?: string;
  challengeTtlSeconds?: number;
  /** optional Nano RPC lookup override; defaults to a public node via block_info */
  nanoRpcLookup?: NanoRpcLookup;
  /**
   * Required for Nano. Production requires an app-owned durable shared store.
   * Explicitly select InMemoryNanoReceiptLedger only for development/tests.
   */
  nanoReceiptLedger?: NanoReceiptLedger;
  /** Required for Nano settlement: independently authorize this payment for this order. */
  nanoPaymentAuthorizer?: NanoPaymentAuthorizer;
}

export class X402PaymentHandler {
  private secretKey: string;
  private payTo: string;
  private defaultNetwork: string;
  private defaultCurrency: string;
  private challengeTtlSeconds: number;
  private nanoRpcLookup: NanoRpcLookup;
  private nanoReceiptLedger?: NanoReceiptLedger;
  private nanoPaymentAuthorizer?: NanoPaymentAuthorizer;

  constructor(options: X402Options) {
    if (!options.secretKey) {
      throw new Error('X402PaymentHandler requires a secretKey for cryptographic verification.');
    }
    this.secretKey = options.secretKey;
    this.payTo = options.payTo || '0x0000000000000000000000000000000000000000';
    this.defaultNetwork = options.defaultNetwork || 'polygon';
    this.defaultCurrency = options.defaultCurrency || 'USD';
    this.challengeTtlSeconds = options.challengeTtlSeconds || 300;
    this.nanoRpcLookup = options.nanoRpcLookup || defaultNanoRpcLookup;
    this.nanoPaymentAuthorizer = options.nanoPaymentAuthorizer;
    this.nanoReceiptLedger = options.nanoReceiptLedger;
    if (this.defaultNetwork === 'nano') {
      this.requireNanoConfiguration();
      if (!this.payTo.startsWith('nano_')) throw new Error('Nano requires a nano_ pay-to address');
    }
  }

  private requireNanoConfiguration(): void {
    if (typeof this.nanoPaymentAuthorizer !== 'function' || !this.nanoReceiptLedger
      || typeof this.nanoReceiptLedger.claim !== 'function') {
      throw new Error('Nano requires a trusted payment authorizer and an explicit receipt ledger before offering payment instructions');
    }
  }

  /**
   * Generates an RFC-compliant HTTP 402 Payment Required challenge and response headers.
   */
  public createChallenge(options: {
    amount: number;
    payTo?: string;
    currency?: string;
    network?: string;
    quoteId?: string;
    ttlSeconds?: number;
    paymentUrl?: string;
    description?: string;
  }): { challenge: X402Challenge; headers: Record<string, string> } {
    const payTo = options.payTo || this.payTo;
    const currency = (options.currency || this.defaultCurrency).toUpperCase();
    const network = options.network || this.defaultNetwork;
    if (network === 'nano') {
      this.requireNanoConfiguration();
      if (currency !== 'XNO' || !payTo.startsWith('nano_') || BigInt(xnoToRaw(options.amount)) <= 0n) {
        throw new Error('Nano challenges require XNO and a nano_ pay-to address');
      }
    }
    const ttl = options.ttlSeconds || this.challengeTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const amountStr = currency === 'XNO' ? rawToXno(BigInt(xnoToRaw(options.amount))) : options.amount.toFixed(2);

    const challengeHeader = `X-402 realm="UCP", pay_to="${payTo}", amount="${amountStr}", currency="${currency}", network="${network}"${
      options.quoteId ? `, quote_id="${options.quoteId}"` : ''
    }, expires_at="${expiresAt}"`;

    const challenge: X402Challenge = {
      version: '1.0',
      payTo,
      amount: options.amount,
      currency,
      network,
      quoteId: options.quoteId,
      expiresAt,
      paymentUrl: options.paymentUrl,
      description: options.description || 'Programmatic payment required for agent resource',
      challengeHeader
    };

    const headers: Record<string, string> = {
      'X-402-Version': '1.0',
      'X-402-Pay-To': payTo,
      'X-402-Amount': amountStr,
      'X-402-Currency': currency,
      'X-402-Network': network,
      'X-402-Expires-At': expiresAt,
      'WWW-Authenticate': challengeHeader
    };

    if (options.quoteId) {
      headers['X-402-Quote-Id'] = options.quoteId;
    }
    if (options.paymentUrl) {
      headers['X-402-Payment-Url'] = options.paymentUrl;
    }

    return { challenge, headers };
  }

  /**
   * Extracts payment authorization tokens from incoming HTTP headers.
   * Supports `X-402-Authorization`, `Authorization: X-402 <token>`, or `Authorization: Bearer x402_<token>`.
   */
  public extractPaymentHeader(headers: Record<string, string | string[] | undefined>): string | null {
    const normalized: Record<string, string> = {};
    for (const key of Object.keys(headers)) {
      const val = headers[key];
      if (typeof val === 'string') {
        normalized[key.toLowerCase()] = val;
      } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
        normalized[key.toLowerCase()] = val[0];
      }
    }

    if (normalized['x-402-authorization']) {
      return normalized['x-402-authorization'];
    }

    const auth = normalized['authorization'];
    if (auth) {
      if (auth.startsWith('X-402 ') || auth.startsWith('x-402 ')) {
        return auth.substring(6).trim();
      }
      if (auth.startsWith('Bearer x402_') || auth.startsWith('bearer x402_')) {
        return auth.substring(7).trim();
      }
      if (auth.startsWith('L402 ') || auth.startsWith('l402 ')) {
        return auth.substring(5).trim();
      }
    }

    return null;
  }

  /**
   * Creates a signed payment proof token for an agent.
   */
  public createPaymentProofToken(payload: {
    quoteId: string;
    amount: number;
    currency: string;
    payerId: string;
    expiresAt?: string;
  }): string {
    const expires = payload.expiresAt || new Date(Date.now() + 3600 * 1000).toISOString();
    const data = `${payload.quoteId}:${payload.amount.toFixed(2)}:${payload.currency}:${payload.payerId}:${expires}`;
    const hmac = crypto.createHmac('sha256', this.secretKey).update(data).digest('hex');
    const tokenObj = {
      quoteId: payload.quoteId,
      amount: payload.amount,
      currency: payload.currency,
      payerId: payload.payerId,
      expiresAt: expires,
      sig: hmac
    };
    return 'x402_' + Buffer.from(JSON.stringify(tokenObj)).toString('base64url');
  }

  /**
   * Verifies an incoming payment proof token or proof object.
   */
  public verifyPayment(tokenOrProof: string | PaymentProof): PaymentVerificationResult {
    try {
      let tokenStr: string;
      if (typeof tokenOrProof === 'string') {
        tokenStr = tokenOrProof;
      } else {
        tokenStr = tokenOrProof.token;
      }

      if (tokenStr.startsWith('x402_')) {
        tokenStr = tokenStr.substring(5);
      }

      const decoded = JSON.parse(Buffer.from(tokenStr, 'base64url').toString('utf-8'));
      if (!decoded.quoteId || !decoded.amount || !decoded.currency || !decoded.payerId || !decoded.sig || !decoded.expiresAt) {
        return { verified: false, error: 'Malformed payment proof token structure' };
      }

      // Check expiration
      if (new Date(decoded.expiresAt).getTime() < Date.now()) {
        return { verified: false, error: 'Payment proof token has expired' };
      }

      // Verify HMAC
      const expectedData = `${decoded.quoteId}:${Number(decoded.amount).toFixed(2)}:${decoded.currency}:${decoded.payerId}:${decoded.expiresAt}`;
      const expectedSig = crypto.createHmac('sha256', this.secretKey).update(expectedData).digest('hex');

      const expectedBuf = Buffer.from(expectedSig, 'hex');
      // Require the complete canonical digest before using the permissive hex decoder.
      const actualBuf = typeof decoded.sig === 'string' && decoded.sig.length === 64 && /^[0-9a-f]{64}$/.test(decoded.sig)
        ? Buffer.from(decoded.sig, 'hex') : Buffer.alloc(0);

      if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
        return { verified: false, error: 'Invalid cryptographic signature on payment proof' };
      }

      const receiptId = 'ucp_rcpt_' + crypto.randomBytes(12).toString('hex');

      return {
        verified: true,
        receiptId,
        amount: Number(decoded.amount),
        currency: decoded.currency,
        payerId: decoded.payerId
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { verified: false, error: `Payment verification failed: ${msg}` };
    }
  }

  /**
   * Verify a Nano (XNO) settlement on-chain. Unlike the signed-proof path above,
   * this reads the public chain: the receipt is the block a stranger can re-read.
   * The payer supplies the block hash in `txHash`; we confirm the block exists,
   * is confirmed, CREDITS the configured pay-to account, carries at least the
   * quoted amount, and has not already settled another order.
   *
   * `payTo` must come from the merchant's own configuration or from a quote field
   * the merchant signed - never from an unauthenticated request body, or the
   * payer redirects the payment to an account they control and pays themselves.
   *
   * Fail-closed: an unreadable, unconfirmed, mismatched or already-spent payment
   * is a rejection, never an acceptance.
   */
  public async verifyNanoSettlement(options: {
    txHash: string;
    amountXno: number | string;
    quoteId: string;
    currency?: string;
    payTo?: string;
  }): Promise<PaymentVerificationResult> {
    const payTo = options.payTo || this.payTo;
    if (!payTo.startsWith('nano_')) {
      return {
        verified: false,
        error: 'A nano network requires a nano_ pay-to address',
      };
    }
    // amountXno is an amount of XNO. A total denominated in anything else has
    // not been converted, and settling it as XNO charges the wrong number.
    const currency = (options.currency || 'XNO').toUpperCase();
    if (currency !== 'XNO') {
      return {
        verified: false,
        error: `A nano settlement must be quoted in XNO, not ${currency}`,
      };
    }
    if (!options.quoteId) {
      return {
        verified: false,
        error: 'A nano settlement must name the quote it settles',
      };
    }
    if (typeof this.nanoPaymentAuthorizer !== 'function' || !this.nanoReceiptLedger) {
      return { verified: false, error: 'Nano settlement requires trusted order-bound payment authorization and an explicit receipt ledger' };
    }
    let expectedRaw: string;
    try {
      expectedRaw = xnoToRaw(options.amountXno);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { verified: false, error: msg };
    }
    if (BigInt(expectedRaw) <= 0n) {
      return { verified: false, error: 'A nano settlement amount must be above zero' };
    }

    // Verify first, then claim the PAYMENT (not the presented hash): a send and
    // the receive that pockets it are two hashes for one payment. The claim is
    // one atomic operation, so two concurrent requests still cannot both settle.
    let result;
    try {
      result = await verifyNanoReceipt(
        options.txHash,
        payTo,
        expectedRaw,
        this.nanoRpcLookup
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { verified: false, error: `Nano settlement lookup failed: ${msg}` };
    }
    if (!result.verified || !result.paymentId) {
      return { verified: false, error: result.reason || 'Nano settlement not verified' };
    }
    // A public receipt proves chain state, not ownership. Authorize before the
    // spent-ledger claim so a stranger cannot steal or burn a buyer's payment.
    try {
      const authorized = await this.nanoPaymentAuthorizer({
        paymentId: result.paymentId, quoteId: options.quoteId, payTo,
        amountRaw: expectedRaw, block: result.info!
      });
      if (authorized !== true) {
        return { verified: false, error: 'Nano payment is not authorized for this order' };
      }
    } catch {
      return { verified: false, error: 'Nano payment authorization unavailable' };
    }
    let claimed: boolean;
    try {
      claimed = await this.nanoReceiptLedger.claim(result.paymentId, options.quoteId);
    } catch {
      return { verified: false, error: 'Nano receipt ledger unavailable' };
    }
    if (claimed !== true) {
      return {
        verified: false,
        error: 'This Nano payment has already settled an order',
      };
    }
    return {
      verified: true,
      receiptId: 'ucp_nano_' + options.txHash.slice(0, 24),
      amount: typeof options.amountXno === 'number'
        ? options.amountXno : rawToXno(BigInt(expectedRaw)),
      currency: 'XNO',
      payerId: options.txHash,
    };
  }
}
