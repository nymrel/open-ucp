/**
 * Universal Commerce Protocol (UCP) - X402 Payment Required Handler
 * Native, zero-dependency implementation of RFC-X402 and AP2 HTTP Payment Protocol
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import * as crypto from 'node:crypto';
import { X402Challenge, PaymentProof, PaymentVerificationResult } from './types.js';

export interface X402Options {
  secretKey: string;
  payTo?: string;
  defaultNetwork?: string;
  defaultCurrency?: string;
  challengeTtlSeconds?: number;
}

export class X402PaymentHandler {
  private secretKey: string;
  private payTo: string;
  private defaultNetwork: string;
  private defaultCurrency: string;
  private challengeTtlSeconds: number;

  constructor(options: X402Options) {
    if (!options.secretKey) {
      throw new Error('X402PaymentHandler requires a secretKey for cryptographic verification.');
    }
    this.secretKey = options.secretKey;
    this.payTo = options.payTo || '0x0000000000000000000000000000000000000000';
    this.defaultNetwork = options.defaultNetwork || 'polygon';
    this.defaultCurrency = options.defaultCurrency || 'USD';
    this.challengeTtlSeconds = options.challengeTtlSeconds || 300;
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
    const ttl = options.ttlSeconds || this.challengeTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    const amountStr = options.amount.toFixed(2);

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
      const actualBuf = Buffer.from(decoded.sig, 'hex');

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
}
