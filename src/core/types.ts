/**
 * Universal Commerce Protocol (UCP) & Agentic Purchasing (AP2) TypeScript Definitions
 * Standard Specification: UCP 1.0.0
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

export interface ParentOrganization {
  name: string;
  legalEntity: string;
  url?: string;
  duns?: string;
}

export interface EntityTrust {
  name: string;
  legalName: string;
  parentOrganization: ParentOrganization;
  url: string;
  contactEmail: string;
  description?: string;
  verified: boolean;
  machineTrustScore: number;
}

export interface UCPCapabilities {
  instantCheckout: boolean;
  machineNegotiation: boolean;
  x402Payments: boolean;
  ap2Protocol: boolean;
  dynamicPricing: boolean;
  streamingSettlement?: boolean;
}

export interface UCPEndpoints {
  catalog: string;
  negotiate: string;
  quote?: string;
  checkout: string;
  verifyPayment?: string;
  webhook?: string;
}

export interface X402RailConfig {
  enabled: boolean;
  payTo: string;
  acceptedTokens: string[];
  defaultNetwork: 'polygon' | 'solana' | 'lightning' | 'base' | 'ethereum' | 'stripe' | string;
  minAmount?: number;
  maxAmount?: number;
  paymentUrl?: string;
}

export interface AP2RailConfig {
  enabled: boolean;
  version: string;
  publicKey?: string;
  supportedAuthorities: string[];
}

export interface StripeRailConfig {
  enabled: boolean;
  accountId?: string;
  publishableKey?: string;
}

export interface PaymentRailsConfig {
  x402?: X402RailConfig;
  ap2?: AP2RailConfig;
  stripe?: StripeRailConfig;
  custom?: Record<string, unknown>;
}

export interface CatalogSummary {
  productCount: number;
  categories: string[];
  currency: string;
}

export interface SecurityPolicy {
  signingAlgorithm: 'HMAC-SHA256' | 'Ed25519';
  quoteTtlSeconds: number;
  rateLimits?: {
    negotiationsPerMinute?: number;
    quotesPerHour?: number;
  };
}

export interface UCPManifest {
  ucpVersion: string;
  protocol: string;
  entity: EntityTrust;
  capabilities: UCPCapabilities;
  endpoints: UCPEndpoints;
  paymentRails: PaymentRailsConfig;
  catalogSummary: CatalogSummary;
  security: SecurityPolicy;
  llmsTxtUrl?: string;
  jsonLdContext?: string;
  updatedAt: string;
}

export interface PricingTier {
  minQuantity: number;
  maxQuantity?: number;
  unitPrice: number;
  discountPercent: number;
}

export interface NegotiationRules {
  allowNegotiation: boolean;
  minAcceptablePrice: number;
  maxDiscountPercent: number;
  volumeSensitivity?: number; // e.g. 0.0 to 1.0 (how quickly discounts scale)
  autoAcceptThreshold?: number; // Price above which agent proposal is instantly accepted
}

export interface ProductOffer {
  sku: string;
  title: string;
  description: string;
  basePrice: number;
  currency: string;
  unit: string;
  stockStatus: 'in_stock' | 'preorder' | 'unlimited' | 'out_of_stock';
  category?: string;
  pricingTiers?: PricingTier[];
  negotiationRules?: NegotiationRules;
  deliveryMethods?: string[];
  metadata?: Record<string, unknown>;
  jsonLd?: Record<string, unknown>;
}

export interface QuoteRequest {
  sku: string;
  quantity: number;
  agentId: string;
  clientNonce: string;
  targetCurrency?: string;
  proposedPrice?: number;
  deliveryPreference?: string;
  metadata?: Record<string, unknown>;
}

export interface SignedQuote {
  quoteId: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
  discountPercent: number;
  savings: number;
  agentId: string;
  clientNonce: string;
  status: 'accepted' | 'counter_offer' | 'rejected';
  reason?: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  settlementInstructions: {
    protocol: 'x402' | 'ap2' | 'stripe' | 'direct';
    payTo?: string;
    network?: string;
    token?: string;
    checkoutUrl?: string;
  };
}

export interface QuoteVerificationResult {
  valid: boolean;
  reason?: string;
  quote?: SignedQuote;
  isExpired?: boolean;
}

export interface X402Challenge {
  version: string;
  payTo: string;
  amount: number;
  currency: string;
  network: string;
  quoteId?: string;
  expiresAt: string;
  paymentUrl?: string;
  description?: string;
  challengeHeader: string;
}

export interface PaymentProof {
  protocol: 'x402' | 'ap2' | 'stripe';
  token: string;
  signature?: string;
  txHash?: string;
  payerId?: string;
  quoteId?: string;
  timestamp: string;
}

export interface PaymentVerificationResult {
  verified: boolean;
  receiptId?: string;
  amount?: number;
  currency?: string;
  payerId?: string;
  error?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationReport {
  valid: boolean;
  score: number; // 0 to 100
  issues: ValidationIssue[];
  details: {
    manifestSchema: boolean;
    entityTrust: boolean;
    parentOrgVerified: boolean;
    endpointsFunctional: boolean;
    paymentRailsConfigured: boolean;
    jsonLdParityScore: number;
    ap2Compliance: boolean;
  };
}
