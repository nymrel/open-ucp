/**
 * Universal Commerce Protocol (UCP) - Express & Fastify Middleware Adapter
 * Zero-dependency, framework-agnostic HTTP middleware
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { UCPManifest, QuoteRequest, PaymentProof } from '../core/types.js';
import { ProductCatalog } from '../core/catalog.js';
import { NegotiationEngine } from '../negotiation/engine.js';
import { X402PaymentHandler, NanoReceiptLedger } from '../core/x402.js';
import { NanoRpcLookup } from '../core/nano.js';

export interface UCPServerConfig {
  manifest: UCPManifest;
  catalog: ProductCatalog;
  secretKey: string;
  /** Use a durable atomic store shared by every worker and retained across restarts. */
  nanoReceiptLedger?: NanoReceiptLedger;
  nanoRpcLookup?: NanoRpcLookup;
  onCheckoutComplete?: (data: {
    quoteId: string;
    sku: string;
    quantity: number;
    amount: number | string;
    receiptId: string;
    payerId: string;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export type ExpressNextFunction = (err?: unknown) => void;

export function ucpExpressMiddleware(config: UCPServerConfig) {
  const negotiationEngine = new NegotiationEngine({
    secretKey: config.secretKey,
    defaultTtlSeconds: config.manifest.security?.quoteTtlSeconds || 300,
    payTo: config.manifest.paymentRails?.x402?.payTo,
    network: config.manifest.paymentRails?.x402?.defaultNetwork
  });

  const configuredPayTo = config.manifest.paymentRails?.x402?.payTo;

  const paymentHandler = new X402PaymentHandler({
    secretKey: config.secretKey,
    payTo: configuredPayTo,
    defaultNetwork: config.manifest.paymentRails?.x402?.defaultNetwork,
    defaultCurrency: config.manifest.catalogSummary?.currency || 'USD',
    nanoReceiptLedger: config.nanoReceiptLedger,
    nanoRpcLookup: config.nanoRpcLookup
  });

  return async (req: IncomingMessage & { body?: any; url?: string; method?: string }, res: ServerResponse, next?: ExpressNextFunction) => {
    const method = (req.method || 'GET').toUpperCase();
    const url = (req.url || '/').split('?')[0];

    // 1. Serve Manifest
    if (method === 'GET' && (url === '/.well-known/ucp.json' || url === '/ucp.json')) {
      const summary = config.catalog.getSummary();
      const dynamicManifest: UCPManifest = {
        ...config.manifest,
        catalogSummary: summary,
        updatedAt: new Date().toISOString()
      };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.end(JSON.stringify(dynamicManifest, null, 2));
      return;
    }

    // 2. Serve Product Catalog
    if (method === 'GET' && (url === config.manifest.endpoints.catalog || url === '/api/ucp/catalog')) {
      const products = config.catalog.getAllProducts();
      const jsonLd = config.catalog.exportJsonLdList();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(JSON.stringify({
        protocol: 'UCP/1.0',
        count: products.length,
        products,
        jsonLd
      }, null, 2));
      return;
    }

    // 3. Machine Negotiation Endpoint
    if (method === 'POST' && (url === config.manifest.endpoints.negotiate || url === '/api/ucp/negotiate')) {
      try {
        const body = await parseJsonBody<QuoteRequest>(req);
        if (!body.sku || !body.quantity || !body.agentId) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Missing required fields: sku, quantity, agentId' }));
          return;
        }

        const product = config.catalog.getProduct(body.sku);
        if (!product) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: `Product SKU '${body.sku}' not found in catalog` }));
          return;
        }

        const quote = negotiationEngine.createQuote(body, product);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify(quote, null, 2));
        return;
      } catch (err: unknown) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const msg = err instanceof Error ? err.message : 'Invalid JSON body';
        res.end(JSON.stringify({ error: msg }));
        return;
      }
    }

    // 4. Autonomous Checkout & Settlement Endpoint
    if (method === 'POST' && (url === config.manifest.endpoints.checkout || url === '/api/ucp/checkout')) {
      try {
        const body = await parseJsonBody<{
          quote: any;
          paymentProof: PaymentProof | string;
        }>(req);

        if (!body.quote || !body.paymentProof) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Missing required fields: quote, paymentProof' }));
          return;
        }

        // Verify quote
        const quoteVerify = negotiationEngine.verifyQuote(body.quote);
        if (!quoteVerify.valid) {
          res.statusCode = 422;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: quoteVerify.reason || 'Invalid or expired quote' }));
          return;
        }

        // Verify payment. For the Nano rail the receipt is a public block a
        // stranger can re-read, so we verify settlement on-chain rather than
        // trusting a self-signed proof token.
        const settleNet = body.quote?.settlementInstructions?.network;
        const proof: PaymentProof = typeof body.paymentProof === 'string'
          ? { protocol: 'x402', token: body.paymentProof, timestamp: new Date().toISOString() }
          : (body.paymentProof as PaymentProof);
        let paymentVerify;
        if (settleNet === 'nano') {
          const txHash = proof?.txHash;
          if (!txHash) {
            res.statusCode = 402;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'A nano settlement requires a txHash (block hash)' }));
            return;
          }
          // The quote's settlement instructions are inside the signed payload, so
          // they arrive authenticated. Check them against our own configuration
          // anyway: the address the money goes to is never worth trusting to one
          // layer, and a mismatch means the quote was not issued for this shop.
          const quotedPayTo = body.quote?.settlementInstructions?.payTo;
          if (configuredPayTo && quotedPayTo && quotedPayTo !== configuredPayTo) {
            res.statusCode = 422;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Quote pay-to does not match this merchant' }));
            return;
          }
          paymentVerify = await paymentHandler.verifyNanoSettlement({
            txHash,
            amountXno: body.quote.totalPrice,
            quoteId: body.quote.quoteId,
            currency: body.quote.currency,
            payTo: configuredPayTo,
          });
        } else {
          paymentVerify = paymentHandler.verifyPayment(proof);
        }
        if (!paymentVerify.verified) {
          res.statusCode = 402;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: paymentVerify.error || 'Payment proof verification failed' }));
          return;
        }

        let fulfillResult: Record<string, unknown> = {};
        if (config.onCheckoutComplete) {
          fulfillResult = await config.onCheckoutComplete({
            quoteId: body.quote.quoteId,
            sku: body.quote.sku,
            quantity: body.quote.quantity,
            amount: body.quote.totalPrice,
            receiptId: paymentVerify.receiptId || 'rcpt_ok',
            payerId: paymentVerify.payerId || body.quote.agentId
          });
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-402-Receipt', paymentVerify.receiptId || '');
        res.end(JSON.stringify({
          status: 'fulfilled',
          quoteId: body.quote.quoteId,
          receiptId: paymentVerify.receiptId,
          amountPaid: body.quote.totalPrice,
          currency: body.quote.currency,
          fulfillment: fulfillResult,
          timestamp: new Date().toISOString()
        }, null, 2));
        return;
      } catch (err: unknown) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const msg = err instanceof Error ? err.message : String(err);
        res.end(JSON.stringify({ error: `Checkout processing failed: ${msg}` }));
        return;
      }
    }

    if (next) {
      next();
    }
  };
}

/**
 * Middleware guarding arbitrary API endpoints with HTTP 402 Payment Required.
 */
export function requireX402(options: {
  paymentHandler: X402PaymentHandler;
  getPrice: (req: IncomingMessage) => number;
  getCurrency?: (req: IncomingMessage) => string;
  description?: string;
}) {
  return async (req: IncomingMessage & { x402Receipt?: string; x402Payer?: string }, res: ServerResponse, next?: ExpressNextFunction) => {
    const paymentHeader = options.paymentHandler.extractPaymentHeader(req.headers as Record<string, string | string[] | undefined>);

    if (!paymentHeader) {
      const amount = options.getPrice(req);
      const currency = options.getCurrency ? options.getCurrency(req) : 'USD';
      const { challenge, headers } = options.paymentHandler.createChallenge({
        amount,
        currency,
        description: options.description
      });

      res.statusCode = 402;
      for (const [k, v] of Object.entries(headers)) {
        res.setHeader(k, v);
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: 'Payment Required',
        challenge
      }, null, 2));
      return;
    }

    const verify = options.paymentHandler.verifyPayment(paymentHeader);
    if (!verify.verified) {
      res.statusCode = 402;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: 'Payment Invalid or Expired',
        detail: verify.error
      }));
      return;
    }

    req.x402Receipt = verify.receiptId;
    req.x402Payer = verify.payerId;
    res.setHeader('X-402-Receipt', verify.receiptId || '');

    if (next) {
      next();
    }
  };
}

async function parseJsonBody<T>(req: IncomingMessage & { body?: any }): Promise<T> {
  if (req.body && typeof req.body === 'object') {
    return req.body as T;
  }

  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(data) as T);
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', err => reject(err));
  });
}
