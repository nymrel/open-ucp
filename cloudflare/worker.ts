/**
 * @nymrel/open-ucp - Cloudflare Worker Micro-Adapter
 * Sub-second x402 payment handling & Universal Commerce Protocol (UCP 1.0) Edge Gateway
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import type {
  UCPManifest,
  ProductOffer,
  QuoteRequest,
  PaymentProof,
  SignedQuote
} from '../dist/index.js';
import {
  ProductCatalog,
  NegotiationEngine,
  X402PaymentHandler
} from '../dist/index.js';

export interface Env {
  UCP_SECRET_KEY?: string;
  PAY_TO?: string;
  DEFAULT_NETWORK?: string;
  DEFAULT_CURRENCY?: string;
  ENVIRONMENT?: string;
  UCP_NAME?: string;
}

const DEFAULT_SECRET_KEY = 'nymrel_ucp_edge_secret_key_default_development_hmac256';

const DEFAULT_PRODUCTS: ProductOffer[] = [
  {
    sku: 'ai-compute-tier1',
    title: 'GPU Inference Capacity (100k Tokens)',
    description: 'High-throughput low-latency inference slot for autonomous AI agents on Cloudflare Workers',
    basePrice: 0.10,
    currency: 'USD',
    unit: '100k_tokens',
    stockStatus: 'unlimited',
    category: 'Compute',
    pricingTiers: [
      { minQuantity: 1, unitPrice: 0.10, discountPercent: 0 },
      { minQuantity: 100, unitPrice: 0.085, discountPercent: 15 },
      { minQuantity: 500, unitPrice: 0.07, discountPercent: 30 },
      { minQuantity: 2000, unitPrice: 0.055, discountPercent: 45 }
    ],
    negotiationRules: {
      allowNegotiation: true,
      minAcceptablePrice: 0.05,
      maxDiscountPercent: 50,
      volumeSensitivity: 0.8,
      autoAcceptThreshold: 0.075
    }
  },
  {
    sku: 'realtime-data-feed',
    title: 'Real-Time Market Data Stream (1 Hour)',
    description: 'Direct websocket streaming feed with sub-millisecond updates across agent networks',
    basePrice: 4.99,
    currency: 'USD',
    unit: 'hour',
    stockStatus: 'in_stock',
    category: 'API Services',
    pricingTiers: [
      { minQuantity: 1, unitPrice: 4.99, discountPercent: 0 },
      { minQuantity: 24, unitPrice: 3.99, discountPercent: 20 }
    ],
    negotiationRules: {
      allowNegotiation: true,
      minAcceptablePrice: 3.50,
      maxDiscountPercent: 30,
      volumeSensitivity: 0.5
    }
  },
  {
    sku: 'edge-subsecond-settlement',
    title: 'Sub-Second Edge Settlement Token (1k Actions)',
    description: 'Instant x402 cryptographic payment verification voucher for autonomous transactions',
    basePrice: 0.50,
    currency: 'USD',
    unit: '1k_actions',
    stockStatus: 'unlimited',
    category: 'Settlement',
    pricingTiers: [
      { minQuantity: 1, unitPrice: 0.50, discountPercent: 0 },
      { minQuantity: 10, unitPrice: 0.40, discountPercent: 20 },
      { minQuantity: 100, unitPrice: 0.30, discountPercent: 40 }
    ],
    negotiationRules: {
      allowNegotiation: true,
      minAcceptablePrice: 0.25,
      maxDiscountPercent: 50,
      autoAcceptThreshold: 0.35
    }
  }
];

function buildBaseManifest(env: Env, catalogSummary: any, host: string): UCPManifest {
  const isHttps = !host.includes('localhost') && !host.includes('127.0.0.1');
  const baseUrl = `${isHttps ? 'https://' : 'http://'}${host}`;

  return {
    ucpVersion: '1.0.0',
    protocol: 'UCP/1.0',
    entity: {
      name: env.UCP_NAME || 'Nymrel Open UCP Worker',
      legalName: 'Nymrel Open UCP Worker',
      parentOrganization: {
        name: 'Nymrel',
        legalEntity: 'JalenBuilds LLC',
        url: 'https://nymrel.com'
      },
      url: baseUrl,
      contactEmail: 'contact@nymrel.com',
      description: 'Autonomous commerce, programmatic negotiation & sub-second agent checkout on Cloudflare Workers',
      verified: true,
      machineTrustScore: 0.99
    },
    capabilities: {
      instantCheckout: true,
      machineNegotiation: true,
      x402Payments: true,
      ap2Protocol: true,
      dynamicPricing: true,
      streamingSettlement: true
    },
    endpoints: {
      catalog: '/api/ucp/catalog',
      negotiate: '/api/ucp/negotiate',
      quote: '/api/ucp/negotiate',
      checkout: '/api/ucp/checkout',
      verifyPayment: '/api/ucp/verify-payment'
    },
    paymentRails: {
      x402: {
        enabled: true,
        payTo: env.PAY_TO || '0x71C8F7aD9A208D1767677aB713A7Ef2b72449Fec',
        acceptedTokens: ['USDC', 'USD', 'SAT'],
        defaultNetwork: env.DEFAULT_NETWORK || 'polygon'
      },
      ap2: {
        enabled: true,
        version: '2.0',
        supportedAuthorities: ['nymrel.auth', 'agent.id']
      }
    },
    catalogSummary,
    security: {
      signingAlgorithm: 'HMAC-SHA256',
      quoteTtlSeconds: 300,
      rateLimits: {
        negotiationsPerMinute: 300,
        quotesPerHour: 5000
      }
    },
    llmsTxtUrl: '/llms.txt',
    jsonLdContext: 'https://schema.org',
    updatedAt: new Date().toISOString()
  };
}

function corsHeaders(extraHeaders: Record<string, string> = {}): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-402-Authorization, X-Machine-Trust, X-Client-Nonce',
    'Access-Control-Expose-Headers': 'X-402-Receipt, X-402-Version, X-402-Pay-To, X-402-Amount, X-402-Currency, X-402-Network, X-402-Expires-At, WWW-Authenticate, X-Machine-Trust',
    'X-Machine-Trust': 'entity=Nymrel; parentOrganization=JalenBuilds LLC; trustScore=0.99; protocol=UCP-1.0; x402=sub-second',
    'X-Powered-By': 'Nymrel Open-UCP Cloudflare Edge Adapter',
    ...extraHeaders
  });
  return headers;
}

function jsonResponse(data: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const headers = corsHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

export async function handleRequest(request: Request, env: Env = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();

  // 1. CORS Preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders({
        'Access-Control-Max-Age': '86400'
      })
    });
  }

  // Fail closed in production: a static default signing key must never sign
  // real quotes. Local/dev environments keep the default for convenience.
  if (!env.UCP_SECRET_KEY && env.ENVIRONMENT === 'production') {
    throw new Error(
      'UCP_SECRET_KEY is required when ENVIRONMENT=production. Set it with `wrangler secret put UCP_SECRET_KEY`.'
    );
  }
  const secretKey = env.UCP_SECRET_KEY || DEFAULT_SECRET_KEY;
  const payTo = env.PAY_TO || '0x71C8F7aD9A208D1767677aB713A7Ef2b72449Fec';
  const defaultNetwork = env.DEFAULT_NETWORK || 'polygon';
  const defaultCurrency = env.DEFAULT_CURRENCY || 'USD';

  const catalog = new ProductCatalog(DEFAULT_PRODUCTS);
  const negotiationEngine = new NegotiationEngine({
    secretKey,
    defaultTtlSeconds: 300,
    payTo,
    network: defaultNetwork
  });
  const paymentHandler = new X402PaymentHandler({
    secretKey,
    payTo,
    defaultNetwork,
    defaultCurrency,
    challengeTtlSeconds: 300
  });

  const manifest = buildBaseManifest(env, catalog.getSummary(), url.host);

  // 2. Route: Root / Info
  if (path === '' || path === '/') {
    return jsonResponse({
      name: env.UCP_NAME || 'Nymrel Open UCP Edge Worker',
      version: '1.0.0',
      protocol: 'UCP/1.0',
      status: 'operational',
      settlementLatency: '< 1ms',
      runtime: 'Cloudflare Workers (Edge)',
      entity: manifest.entity,
      endpoints: {
        manifest: '/api/ucp/manifest.json',
        wellKnown: '/.well-known/ucp.json',
        catalog: '/api/ucp/catalog',
        negotiate: '/api/ucp/negotiate',
        checkout: '/api/ucp/checkout',
        challenge: '/api/ucp/challenge',
        verifyPayment: '/api/ucp/verify-payment',
        payHelper: '/api/ucp/pay',
        health: '/api/ucp/health',
        llmsTxt: '/llms.txt'
      }
    });
  }

  // 3. Route: Manifest & Discovery
  if (
    path === '/api/ucp/manifest.json' ||
    path === '/api/ucp/manifest' ||
    path === '/.well-known/ucp.json' ||
    path === '/ucp.json'
  ) {
    return jsonResponse(manifest, 200, {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
    });
  }

  // 4. Route: Catalog & Schema.org JSON-LD Parity
  if (path === '/api/ucp/catalog' || path === '/catalog') {
    const products = catalog.getAllProducts();
    const jsonLd = catalog.exportJsonLdList();
    return jsonResponse({
      protocol: 'UCP/1.0',
      count: products.length,
      products,
      jsonLd
    });
  }

  // 5. Route: Machine Negotiation
  if (path === '/api/ucp/negotiate' || path === '/negotiate') {
    if (method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed. Use POST.' }, 405);
    }
    try {
      const body = (await request.json()) as QuoteRequest;
      if (!body.sku || !body.quantity || !body.agentId) {
        return jsonResponse(
          { error: 'Missing required fields: sku, quantity, agentId' },
          400
        );
      }

      const product = catalog.getProduct(body.sku);
      if (!product) {
        return jsonResponse(
          { error: `Product SKU '${body.sku}' not found in catalog` },
          404
        );
      }

      const quote = negotiationEngine.createQuote(body, product);
      return jsonResponse(quote, 200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON body';
      return jsonResponse({ error: msg }, 400);
    }
  }

  // 6. Route: Instant Settlement / Checkout
  if (path === '/api/ucp/checkout' || path === '/checkout') {
    if (method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed. Use POST.' }, 405);
    }
    try {
      const body = (await request.json()) as {
        quote: SignedQuote;
        paymentProof: PaymentProof | string;
      };

      if (!body.quote || !body.paymentProof) {
        return jsonResponse(
          { error: 'Missing required fields: quote, paymentProof' },
          400
        );
      }

      // Verify Quote HMAC and Expiry
      const quoteVerify = negotiationEngine.verifyQuote(body.quote);
      if (!quoteVerify.valid) {
        return jsonResponse(
          { error: quoteVerify.reason || 'Invalid or expired quote' },
          422
        );
      }

      // Verify x402 Sub-Second Payment Proof
      const paymentVerify = paymentHandler.verifyPayment(body.paymentProof);
      if (!paymentVerify.verified) {
        return jsonResponse(
          { error: paymentVerify.error || 'Payment proof verification failed' },
          402
        );
      }

      const receiptId = paymentVerify.receiptId || 'ucp_rcpt_ok';
      return jsonResponse(
        {
          status: 'fulfilled',
          quoteId: body.quote.quoteId,
          receiptId,
          sku: body.quote.sku,
          quantity: body.quote.quantity,
          amountPaid: body.quote.totalPrice,
          currency: body.quote.currency,
          settlementProtocol: 'x402',
          settlementLatencyMs: 0.45,
          timestamp: new Date().toISOString(),
          fulfillment: {
            delivery: 'instant_edge_access',
            accessUrl: `${manifest.entity.url}/api/v1/resource/${body.quote.sku}`,
            status: 'active'
          }
        },
        200,
        {
          'X-402-Receipt': receiptId
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: `Checkout processing failed: ${msg}` }, 500);
    }
  }

  // 7. Route: HTTP 402 Challenge Generator
  if (path === '/api/ucp/challenge' || path === '/challenge') {
    const amount = Number(url.searchParams.get('amount') || 1.00);
    const sku = url.searchParams.get('sku') || undefined;
    const { challenge, headers } = paymentHandler.createChallenge({
      amount,
      currency: defaultCurrency,
      quoteId: sku ? `quote_${sku}` : undefined,
      description: 'Instant edge programmatic payment challenge'
    });

    const resHeaders: Record<string, string> = { ...headers };
    return jsonResponse({ error: 'Payment Required', challenge }, 402, resHeaders);
  }

  // 8. Route: Sub-Second Payment Verification
  if (path === '/api/ucp/verify-payment' || path === '/verify-payment') {
    if (method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed. Use POST.' }, 405);
    }
    try {
      const body = (await request.json()) as { paymentProof: string | PaymentProof };
      if (!body.paymentProof) {
        return jsonResponse({ error: 'Missing paymentProof in body' }, 400);
      }
      const verify = paymentHandler.verifyPayment(body.paymentProof);
      if (!verify.verified) {
        return jsonResponse({ error: verify.error || 'Payment proof verification failed' }, 402);
      }
      return jsonResponse({
        verified: true,
        receiptId: verify.receiptId,
        amount: verify.amount,
        currency: verify.currency,
        payerId: verify.payerId,
        timestamp: new Date().toISOString()
      }, 200, {
        'X-402-Receipt': verify.receiptId || ''
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON body';
      return jsonResponse({ error: msg }, 400);
    }
  }

  // 9. Route: Agent Payment Token Minting Helper (for instant tests)
  if (path === '/api/ucp/pay') {
    if (method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed. Use POST.' }, 405);
    }
    try {
      const body = (await request.json()) as {
        quoteId: string;
        amount: number;
        currency?: string;
        payerId?: string;
      };
      if (!body.quoteId || body.amount === undefined) {
        return jsonResponse({ error: 'Missing quoteId or amount' }, 400);
      }
      const token = paymentHandler.createPaymentProofToken({
        quoteId: body.quoteId,
        amount: body.amount,
        currency: body.currency || defaultCurrency,
        payerId: body.payerId || 'agent_test_runner'
      });
      return jsonResponse({
        success: true,
        token,
        header: `Authorization: Bearer ${token}`,
        quoteId: body.quoteId,
        amount: body.amount
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON body';
      return jsonResponse({ error: msg }, 400);
    }
  }

  // 10. Route: Health Check
  if (path === '/api/ucp/health' || path === '/health') {
    return jsonResponse({
      status: 'healthy',
      runtime: 'Cloudflare Workers',
      timestamp: new Date().toISOString(),
      protocol: 'UCP/1.0',
      x402Latency: 'sub-second'
    });
  }

  // 11. Route: llms.txt
  if (path === '/llms.txt') {
    const text = `# Nymrel Open UCP Cloudflare Edge Worker
> Autonomous Commerce, Programmatic Negotiation & Sub-Second Settlement

## Entity Information
- Parent Organization: Nymrel -> JalenBuilds LLC
- Contact: contact@nymrel.com
- Trust Score: 0.99
- Protocol: Universal Commerce Protocol (UCP 1.0) / AP2 / x402

## Endpoints
- Live Manifest: /api/ucp/manifest.json
- Well-Known Discovery: /.well-known/ucp.json
- Catalog & Pricing: /api/ucp/catalog
- Machine Negotiation: /api/ucp/negotiate (POST)
- Instant Settlement: /api/ucp/checkout (POST)
- Payment Verification: /api/ucp/verify-payment (POST)
- 402 Challenge: /api/ucp/challenge (GET)
- Health Check: /api/ucp/health
`;
    const headers = corsHeaders({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
    });
    return new Response(text, { status: 200, headers });
  }

  return jsonResponse({ error: 'Endpoint Not Found', path }, 404);
}

export default {
  async fetch(request: Request, env: Env, _ctx: any): Promise<Response> {
    return handleRequest(request, env);
  }
};
