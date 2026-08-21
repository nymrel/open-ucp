/**
 * Universal Commerce Protocol (UCP) Negotiation Types
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

export { QuoteRequest, SignedQuote, QuoteVerificationResult, ProductOffer, PricingTier, NegotiationRules } from '../core/types.js';

export interface NegotiationEngineOptions {
  secretKey: string;
  defaultTtlSeconds?: number;
  defaultProtocol?: 'x402' | 'ap2' | 'stripe' | 'direct';
  payTo?: string;
  network?: string;
}
