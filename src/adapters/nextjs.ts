/**
 * Universal Commerce Protocol (UCP) - Next.js Adapter
 * Compatible with Next.js App Router (Web standard Request/Response) & Pages Router (Node req/res)
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { UCPManifest, QuoteRequest, PaymentProof } from '../core/types.js';
import { NegotiationEngine } from '../negotiation/engine.js';
import { X402PaymentHandler } from '../core/x402.js';
import { UCPServerConfig } from './express.js';

export function createUCPAppRouter(config: UCPServerConfig) {
  const negotiationEngine = new NegotiationEngine({
    secretKey: config.secretKey,
    defaultTtlSeconds: config.manifest.security?.quoteTtlSeconds || 300,
    payTo: config.manifest.paymentRails?.x402?.payTo,
    network: config.manifest.paymentRails?.x402?.defaultNetwork
  });

  const paymentHandler = new X402PaymentHandler({
    secretKey: config.secretKey,
    payTo: config.manifest.paymentRails?.x402?.payTo,
    defaultNetwork: config.manifest.paymentRails?.x402?.defaultNetwork,
    defaultCurrency: config.manifest.catalogSummary?.currency || 'USD'
  });

  const handleGet = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Manifest
    if (path === '/.well-known/ucp.json' || path === '/ucp.json' || path.endsWith('/ucp.json')) {
      const dynamicManifest: UCPManifest = {
        ...config.manifest,
        catalogSummary: config.catalog.getSummary(),
        updatedAt: new Date().toISOString()
      };
      return new Response(JSON.stringify(dynamicManifest, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60'
        }
      });
    }

    // 2. Catalog
    if (path === config.manifest.endpoints.catalog || path.endsWith('/catalog')) {
      const products = config.catalog.getAllProducts();
      const jsonLd = config.catalog.exportJsonLdList();
      return new Response(
        JSON.stringify({
          protocol: 'UCP/1.0',
          count: products.length,
          products,
          jsonLd
        }, null, 2),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    return new Response(JSON.stringify({ error: 'UCP Route Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const handlePost = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;

    // 3. Negotiate
    if (path === config.manifest.endpoints.negotiate || path.endsWith('/negotiate')) {
      try {
        const body = (await request.json()) as QuoteRequest;
        if (!body.sku || !body.quantity || !body.agentId) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: sku, quantity, agentId' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const product = config.catalog.getProduct(body.sku);
        if (!product) {
          return new Response(
            JSON.stringify({ error: `Product SKU '${body.sku}' not found in catalog` }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const quote = negotiationEngine.createQuote(body, product);
        return new Response(JSON.stringify(quote, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid JSON body';
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 4. Checkout
    if (path === config.manifest.endpoints.checkout || path.endsWith('/checkout')) {
      try {
        const body = (await request.json()) as {
          quote: any;
          paymentProof: PaymentProof | string;
        };

        if (!body.quote || !body.paymentProof) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields: quote, paymentProof' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const quoteVerify = negotiationEngine.verifyQuote(body.quote);
        if (!quoteVerify.valid) {
          return new Response(
            JSON.stringify({ error: quoteVerify.reason || 'Invalid or expired quote' }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const paymentVerify = paymentHandler.verifyPayment(body.paymentProof);
        if (!paymentVerify.verified) {
          return new Response(
            JSON.stringify({ error: paymentVerify.error || 'Payment proof verification failed' }),
            { status: 402, headers: { 'Content-Type': 'application/json' } }
          );
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

        return new Response(
          JSON.stringify({
            status: 'fulfilled',
            quoteId: body.quote.quoteId,
            receiptId: paymentVerify.receiptId,
            amountPaid: body.quote.totalPrice,
            currency: body.quote.currency,
            fulfillment: fulfillResult,
            timestamp: new Date().toISOString()
          }, null, 2),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'X-402-Receipt': paymentVerify.receiptId || ''
            }
          }
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: `Checkout processing failed: ${msg}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ error: 'UCP Action Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  return {
    GET: handleGet,
    POST: handlePost
  };
}

/**
 * Route protector for Next.js App Router using HTTP 402 Payment Required.
 */
export function withX402(
  handler: (request: Request, context: { receiptId: string; payerId: string }) => Promise<Response>,
  options: {
    paymentHandler: X402PaymentHandler;
    price: number | ((request: Request) => number);
    currency?: string;
    description?: string;
  }
) {
  return async (request: Request): Promise<Response> => {
    const rawHeaders: Record<string, string> = {};
    request.headers.forEach((val, key) => {
      rawHeaders[key] = val;
    });

    const paymentHeader = options.paymentHandler.extractPaymentHeader(rawHeaders);
    if (!paymentHeader) {
      const price = typeof options.price === 'function' ? options.price(request) : options.price;
      const { challenge, headers } = options.paymentHandler.createChallenge({
        amount: price,
        currency: options.currency || 'USD',
        description: options.description
      });

      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(headers)) {
        resHeaders.set(k, v);
      }
      resHeaders.set('Content-Type', 'application/json; charset=utf-8');

      return new Response(
        JSON.stringify({ error: 'Payment Required', challenge }, null, 2),
        {
          status: 402,
          headers: resHeaders
        }
      );
    }

    const verify = options.paymentHandler.verifyPayment(paymentHeader);
    if (!verify.verified) {
      return new Response(
        JSON.stringify({ error: 'Payment Invalid or Expired', detail: verify.error }),
        {
          status: 402,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const response = await handler(request, {
      receiptId: verify.receiptId || '',
      payerId: verify.payerId || ''
    });

    response.headers.set('X-402-Receipt', verify.receiptId || '');
    return response;
  };
}
