/**
 * Universal Commerce Protocol (UCP) Machine Negotiation Engine
 * Programmatic pricing, volume discounts, and cryptographic quote signing
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import * as crypto from 'node:crypto';
import {
  QuoteRequest,
  SignedQuote,
  QuoteVerificationResult,
  ProductOffer,
  PricingTier
} from '../core/types.js';
import { NegotiationEngineOptions } from './types.js';

export class NegotiationEngine {
  private secretKey: string;
  private defaultTtlSeconds: number;
  private defaultProtocol: 'x402' | 'ap2' | 'stripe' | 'direct';
  private payTo?: string;
  private network?: string;

  constructor(options: NegotiationEngineOptions) {
    if (!options.secretKey) {
      throw new Error('NegotiationEngine requires a secretKey for quote signing and verification.');
    }
    this.secretKey = options.secretKey;
    this.defaultTtlSeconds = options.defaultTtlSeconds || 300;
    this.defaultProtocol = options.defaultProtocol || 'x402';
    this.payTo = options.payTo;
    this.network = options.network;
  }

  /**
   * Processes an incoming QuoteRequest from an autonomous agent and returns a SignedQuote.
   */
  public createQuote(request: QuoteRequest, product: ProductOffer): SignedQuote {
    if (product.stockStatus === 'out_of_stock') {
      return this.generateRejectedQuote(
        request,
        product,
        'Item is currently out of stock'
      );
    }

    if (request.quantity <= 0 || !Number.isFinite(request.quantity)) {
      return this.generateRejectedQuote(
        request,
        product,
        'Invalid quantity requested'
      );
    }

    const basePrice = product.basePrice;
    let effectiveUnitPrice = basePrice;
    let appliedDiscountPercent = 0;

    // 1. Check pricing tiers for volume discounts
    if (product.pricingTiers && product.pricingTiers.length > 0) {
      const matchedTier = this.findMatchingTier(product.pricingTiers, request.quantity);
      if (matchedTier) {
        effectiveUnitPrice = matchedTier.unitPrice;
        appliedDiscountPercent = matchedTier.discountPercent;
      }
    }

    // 2. Machine Negotiation Rules Evaluation
    const rules = product.negotiationRules;
    let status: 'accepted' | 'counter_offer' | 'rejected' = 'accepted';
    let reason = 'Quote generated according to standard pricing schedule';

    if (rules && rules.allowNegotiation && request.proposedPrice !== undefined) {
      const proposed = request.proposedPrice;
      const minPrice = rules.minAcceptablePrice;
      const maxDiscount = rules.maxDiscountPercent;
      const autoAccept = rules.autoAcceptThreshold ?? basePrice * (1 - (maxDiscount / 100) * 0.5);

      if (proposed >= effectiveUnitPrice) {
        // Agent offered higher or equal to tier price
        effectiveUnitPrice = effectiveUnitPrice;
        status = 'accepted';
        reason = 'Proposed price meets or exceeds standard tier price';
      } else if (proposed >= autoAccept) {
        // Proposed price is within auto-accept threshold
        effectiveUnitPrice = proposed;
        appliedDiscountPercent = Number((((basePrice - proposed) / basePrice) * 100).toFixed(2));
        status = 'accepted';
        reason = 'Agent proposed price auto-accepted';
      } else if (proposed >= minPrice) {
        // Between floor and auto-accept: calculate counter-offer or accept with volume sensitivity
        const volumeSens = rules.volumeSensitivity ?? 0.5;
        const volumeFactor = Math.min(1, Math.log10(request.quantity + 1) * volumeSens);
        
        // Counter-offer bridges the gap weighted by volume
        const counterPrice = Number(
          (minPrice + (effectiveUnitPrice - minPrice) * (1 - volumeFactor * 0.5)).toFixed(2)
        );

        if (proposed >= counterPrice) {
          effectiveUnitPrice = proposed;
          appliedDiscountPercent = Number((((basePrice - proposed) / basePrice) * 100).toFixed(2));
          status = 'accepted';
          reason = 'Agent proposal accepted based on volume dynamic margin curve';
        } else {
          effectiveUnitPrice = counterPrice;
          appliedDiscountPercent = Number((((basePrice - counterPrice) / basePrice) * 100).toFixed(2));
          status = 'counter_offer';
          reason = `Proposed price below volume curve. Counter-offer extended at ${counterPrice} ${product.currency}`;
        }
      } else {
        // Below minimum acceptable price floor
        effectiveUnitPrice = minPrice;
        appliedDiscountPercent = Number((((basePrice - minPrice) / basePrice) * 100).toFixed(2));
        status = 'counter_offer';
        reason = `Proposed price below minimum floor (${minPrice} ${product.currency}). Floor counter-offer extended.`;
      }
    } else if (rules && !rules.allowNegotiation && request.proposedPrice !== undefined && request.proposedPrice < effectiveUnitPrice) {
      status = 'counter_offer';
      reason = 'Fixed pricing policy in effect. Negotiation not enabled for this SKU.';
    }

    const totalPrice = Number((effectiveUnitPrice * request.quantity).toFixed(2));
    const baseTotal = Number((basePrice * request.quantity).toFixed(2));
    const savings = Number((baseTotal - totalPrice).toFixed(2));

    const quoteId = 'ucp_quote_' + crypto.randomBytes(12).toString('hex');
    const now = new Date();
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.defaultTtlSeconds * 1000).toISOString();

    const signature = this.signQuotePayload({
      quoteId,
      sku: product.sku,
      quantity: request.quantity,
      totalPrice,
      currency: product.currency,
      expiresAt,
      agentId: request.agentId,
      clientNonce: request.clientNonce
    });

    return {
      quoteId,
      sku: product.sku,
      quantity: request.quantity,
      unitPrice: effectiveUnitPrice,
      totalPrice,
      currency: product.currency,
      discountPercent: appliedDiscountPercent,
      savings,
      agentId: request.agentId,
      clientNonce: request.clientNonce,
      status,
      reason,
      issuedAt,
      expiresAt,
      signature,
      settlementInstructions: {
        protocol: this.defaultProtocol,
        payTo: this.payTo,
        network: this.network
      }
    };
  }

  /**
   * Verifies the cryptographic HMAC signature and validity of a SignedQuote.
   */
  public verifyQuote(quote: SignedQuote): QuoteVerificationResult {
    try {
      // Check expiration
      const expiresTime = new Date(quote.expiresAt).getTime();
      if (Date.now() > expiresTime) {
        return {
          valid: false,
          isExpired: true,
          reason: 'Quote has expired',
          quote
        };
      }

      // Compute expected HMAC
      const expectedSig = this.signQuotePayload({
        quoteId: quote.quoteId,
        sku: quote.sku,
        quantity: quote.quantity,
        totalPrice: quote.totalPrice,
        currency: quote.currency,
        expiresAt: quote.expiresAt,
        agentId: quote.agentId,
        clientNonce: quote.clientNonce
      });

      const expectedBuf = Buffer.from(expectedSig, 'hex');
      const actualBuf = Buffer.from(quote.signature, 'hex');

      if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
        return {
          valid: false,
          reason: 'Cryptographic signature mismatch on quote',
          quote
        };
      }

      return {
        valid: true,
        isExpired: false,
        quote
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        valid: false,
        reason: `Quote verification exception: ${msg}`,
        quote
      };
    }
  }

  private findMatchingTier(tiers: PricingTier[], quantity: number): PricingTier | null {
    // Sort tiers by minQuantity descending
    const sorted = [...tiers].sort((a, b) => b.minQuantity - a.minQuantity);
    for (const tier of sorted) {
      if (quantity >= tier.minQuantity) {
        if (tier.maxQuantity === undefined || quantity <= tier.maxQuantity) {
          return tier;
        }
      }
    }
    return null;
  }

  private generateRejectedQuote(
    request: QuoteRequest,
    product: ProductOffer,
    reason: string
  ): SignedQuote {
    const quoteId = 'ucp_quote_rej_' + crypto.randomBytes(8).toString('hex');
    const now = new Date();
    return {
      quoteId,
      sku: product.sku,
      quantity: request.quantity,
      unitPrice: product.basePrice,
      totalPrice: 0,
      currency: product.currency,
      discountPercent: 0,
      savings: 0,
      agentId: request.agentId,
      clientNonce: request.clientNonce,
      status: 'rejected',
      reason,
      issuedAt: now.toISOString(),
      expiresAt: now.toISOString(),
      signature: '0'.repeat(64),
      settlementInstructions: {
        protocol: this.defaultProtocol
      }
    };
  }

  private signQuotePayload(payload: {
    quoteId: string;
    sku: string;
    quantity: number;
    totalPrice: number;
    currency: string;
    expiresAt: string;
    agentId: string;
    clientNonce: string;
  }): string {
    const serialized = [
      payload.quoteId,
      payload.sku,
      payload.quantity.toString(),
      payload.totalPrice.toFixed(2),
      payload.currency.toUpperCase(),
      payload.expiresAt,
      payload.agentId,
      payload.clientNonce
    ].join(':');

    return crypto.createHmac('sha256', this.secretKey).update(serialized).digest('hex');
  }
}
