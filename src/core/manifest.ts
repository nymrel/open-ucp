/**
 * Universal Commerce Protocol (UCP) Manifest Builder
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import {
  UCPManifest,
  EntityTrust,
  UCPCapabilities,
  UCPEndpoints,
  PaymentRailsConfig,
  CatalogSummary,
  SecurityPolicy
} from './types.js';

export class UCPManifestBuilder {
  private manifest: UCPManifest;

  constructor(baseManifest?: Partial<UCPManifest>) {
    this.manifest = {
      ucpVersion: '1.0.0',
      protocol: 'UCP/1.0',
      entity: {
        name: 'Nymrel Platform',
        legalName: 'Nymrel',
        parentOrganization: {
          name: 'Nymrel',
          legalEntity: 'JalenBuilds LLC',
          url: 'https://jalenbuilds.com'
        },
        url: 'https://nymrel.com',
        contactEmail: 'contact@nymrel.com',
        description: 'Autonomous commerce, programmatic negotiation & agent checkout infrastructure',
        verified: true,
        machineTrustScore: 0.99
      },
      capabilities: {
        instantCheckout: true,
        machineNegotiation: true,
        x402Payments: true,
        ap2Protocol: true,
        dynamicPricing: true,
        streamingSettlement: false
      },
      endpoints: {
        catalog: '/api/ucp/catalog',
        negotiate: '/api/ucp/negotiate',
        quote: '/api/ucp/quote',
        checkout: '/api/ucp/checkout',
        verifyPayment: '/api/ucp/verify-payment'
      },
      paymentRails: {
        x402: {
          enabled: true,
          payTo: '0x0000000000000000000000000000000000000000',
          acceptedTokens: ['USDC', 'USD', 'SAT'],
          defaultNetwork: 'polygon'
        },
        ap2: {
          enabled: true,
          version: '2.0',
          supportedAuthorities: ['nymrel.auth', 'agent.id']
        }
      },
      catalogSummary: {
        productCount: 0,
        categories: [],
        currency: 'USD'
      },
      security: {
        signingAlgorithm: 'HMAC-SHA256',
        quoteTtlSeconds: 300,
        rateLimits: {
          negotiationsPerMinute: 60,
          quotesPerHour: 500
        }
      },
      llmsTxtUrl: '/llms.txt',
      jsonLdContext: 'https://schema.org',
      updatedAt: new Date().toISOString(),
      ...baseManifest
    };
  }

  public setEntity(entity: Partial<EntityTrust>): this {
    this.manifest.entity = {
      ...this.manifest.entity,
      ...entity,
      parentOrganization: {
        ...this.manifest.entity.parentOrganization,
        ...(entity.parentOrganization || {})
      }
    };
    return this;
  }

  public setCapabilities(capabilities: Partial<UCPCapabilities>): this {
    this.manifest.capabilities = {
      ...this.manifest.capabilities,
      ...capabilities
    };
    return this;
  }

  public setEndpoints(endpoints: Partial<UCPEndpoints>): this {
    this.manifest.endpoints = {
      ...this.manifest.endpoints,
      ...endpoints
    };
    return this;
  }

  public setPaymentRails(paymentRails: Partial<PaymentRailsConfig>): this {
    this.manifest.paymentRails = {
      ...this.manifest.paymentRails,
      ...paymentRails
    };
    return this;
  }

  public setCatalogSummary(summary: Partial<CatalogSummary>): this {
    this.manifest.catalogSummary = {
      ...this.manifest.catalogSummary,
      ...summary
    };
    return this;
  }

  public setSecurity(security: Partial<SecurityPolicy>): this {
    this.manifest.security = {
      ...this.manifest.security,
      ...security
    };
    return this;
  }

  public setLLMsTxt(url: string): this {
    this.manifest.llmsTxtUrl = url;
    return this;
  }

  public build(): UCPManifest {
    return {
      ...this.manifest,
      updatedAt: new Date().toISOString()
    };
  }

  public toJSON(indent = 2): string {
    return JSON.stringify(this.build(), null, indent);
  }
}

export function createDefaultManifest(options?: {
  name?: string;
  url?: string;
  contactEmail?: string;
  payTo?: string;
  network?: string;
}): UCPManifest {
  const builder = new UCPManifestBuilder();
  if (options?.name || options?.url || options?.contactEmail) {
    builder.setEntity({
      name: options.name || 'Nymrel Merchant',
      url: options.url || 'https://example.com',
      contactEmail: options.contactEmail || 'contact@nymrel.com'
    });
  }
  if (options?.payTo || options?.network) {
    builder.setPaymentRails({
      x402: {
        enabled: true,
        payTo: options.payTo || '0x0000000000000000000000000000000000000000',
        acceptedTokens: ['USDC', 'USD'],
        defaultNetwork: options.network || 'polygon'
      }
    });
  }
  return builder.build();
}
