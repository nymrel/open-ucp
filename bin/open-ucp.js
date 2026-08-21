#!/usr/bin/env node

/**
 * open-ucp CLI Tool
 * Universal Commerce Protocol (UCP) Scaffolding, Validation, Server & Testing CLI
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VERSION = '1.0.0';

const HELP_TEXT = `
  __  __   ____   ____      _   _  ____   ____ 
 | | | |  / ___| |  _ \\    | | | ||  _ \\ / ___|
 | | | | | |     | |_) |   | | | || |_) | |    
 | |_| | | |___  |  __/    | |_| ||  __/| |___ 
  \\___/   \\____| |_|        \\___/ |_|    \\____|
  Universal Commerce Protocol (UCP 1.0.0) Engine

Usage:
  open-ucp <command> [options]

Commands:
  init                      Scaffold a new ucp.config.json in the current directory
  validate <file-or-url>    Validate a local ucp.json or remote /.well-known/ucp.json
  serve [options]           Start standalone zero-dependency UCP mock/dev server
  inspect <url>             Inspect machine-trust & payment rails on a live site
  quote [options]           Simulate an AI agent requesting a negotiated quote
  version                   Display version information
  help                      Show this help dialog

Options for serve:
  --port, -p <number>       Port to listen on (default: 4020)
  --config, -c <file>       Path to ucp.config.json (default: ./ucp.config.json)

Options for quote:
  --sku <sku>               Product SKU to quote (default: "ai-compute-tier1")
  --qty, -q <number>        Quantity (default: 100)
  --price <number>          Proposed unit price for negotiation
  --url <url>               Negotiation endpoint (default: "http://localhost:4020/api/ucp/negotiate")
  --agent <id>              Agent identifier (default: "agent_alpha_01")

Examples:
  open-ucp init --name "My Merchant" --email "contact@example.com"
  open-ucp validate ./ucp.config.json
  open-ucp serve --port 4020
  open-ucp quote --sku "ai-compute-tier1" --qty 500 --price 0.08
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'init':
      await handleInit(args.slice(1));
      break;
    case 'validate':
      await handleValidate(args.slice(1));
      break;
    case 'serve':
      await handleServe(args.slice(1));
      break;
    case 'inspect':
      await handleInspect(args.slice(1));
      break;
    case 'quote':
      await handleQuote(args.slice(1));
      break;
    case 'version':
    case '-v':
    case '--version':
      console.log(`open-ucp v${VERSION}`);
      break;
    case 'help':
    case '-h':
    case '--help':
    default:
      console.log(HELP_TEXT);
      break;
  }
}

async function handleInit(args) {
  const parsed = parseArgs(args);
  const targetFile = path.resolve(process.cwd(), 'ucp.config.json');

  if (fs.existsSync(targetFile) && !parsed.force) {
    console.log(`\x1b[33m[!] ucp.config.json already exists at ${targetFile}. Use --force to overwrite.\x1b[0m`);
    return;
  }

  const name = parsed.name || 'Nymrel Autonomous Store';
  const url = parsed.url || 'https://example.com';
  const email = parsed.email || 'contact@nymrel.com';

  const starterConfig = {
    manifest: {
      ucpVersion: '1.0.0',
      protocol: 'UCP/1.0',
      entity: {
        name,
        legalName: name,
        parentOrganization: {
          name: 'Nymrel',
          legalEntity: 'JalenBuilds LLC',
          url: 'https://jalenbuilds.com'
        },
        url,
        contactEmail: email,
        description: 'Autonomous commerce, programmatic negotiation & agent checkout endpoint',
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
          payTo: '0x71C...NymrelVault',
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
        productCount: 2,
        categories: ['Compute', 'API Services'],
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
      jsonLdContext: 'https://schema.org'
    },
    secretKey: crypto.randomBytes(32).toString('hex'),
    products: [
      {
        sku: 'ai-compute-tier1',
        title: 'GPU Inference Capacity (100k Tokens)',
        description: 'High-throughput low-latency inference slot for autonomous AI agents',
        basePrice: 0.10,
        currency: 'USD',
        unit: '100k_tokens',
        stockStatus: 'unlimited',
        category: 'Compute',
        pricingTiers: [
          { minQuantity: 1, unitPrice: 0.10, discountPercent: 0 },
          { minQuantity: 100, unitPrice: 0.085, discountPercent: 15 },
          { minQuantity: 500, unitPrice: 0.070, discountPercent: 30 },
          { minQuantity: 2000, unitPrice: 0.055, discountPercent: 45 }
        ],
        negotiationRules: {
          allowNegotiation: true,
          minAcceptablePrice: 0.050,
          maxDiscountPercent: 50,
          volumeSensitivity: 0.8,
          autoAcceptThreshold: 0.075
        }
      },
      {
        sku: 'realtime-data-feed',
        title: 'Real-Time Market Data Stream (1 Hour)',
        description: 'Direct websocket streaming feed with sub-millisecond updates',
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
      }
    ]
  };

  fs.writeFileSync(targetFile, JSON.stringify(starterConfig, null, 2), 'utf-8');
  console.log(`\x1b[32m[✓] Scaffolded starter UCP configuration:\x1b[0m ${targetFile}`);
  console.log(`\x1b[36m    Next steps:\x1b[0m`);
  console.log(`      1. Validate:   open-ucp validate ucp.config.json`);
  console.log(`      2. Dev Server: open-ucp serve --port 4020`);
}

async function handleValidate(args) {
  const target = args[0] || 'ucp.config.json';
  console.log(`\x1b[36m[*] Auditing UCP Manifest:\x1b[0m ${target}`);

  let content;
  try {
    if (target.startsWith('http://') || target.startsWith('https://')) {
      content = await fetchHttp(target);
    } else {
      const fullPath = path.resolve(process.cwd(), target);
      if (!fs.existsSync(fullPath)) {
        console.log(`\x1b[31m[x] File not found: ${fullPath}\x1b[0m`);
        process.exit(1);
      }
      content = fs.readFileSync(fullPath, 'utf-8');
    }
  } catch (err) {
    console.log(`\x1b[31m[x] Failed to load target: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.log(`\x1b[31m[x] JSON Parse Error: Invalid JSON document\x1b[0m`);
    process.exit(1);
  }

  const manifest = parsed.manifest || parsed;
  const products = parsed.products || [];

  // Run validation
  const errors = [];
  const warnings = [];

  if (!manifest.ucpVersion) errors.push('Missing ucpVersion');
  if (!manifest.protocol || !manifest.protocol.startsWith('UCP/')) errors.push('Invalid protocol identifier (must start with UCP/)');
  if (!manifest.entity?.name) errors.push('Missing entity.name');
  if (!manifest.entity?.url) errors.push('Missing entity.url');
  if (!manifest.entity?.contactEmail) errors.push('Missing entity.contactEmail');
  if (!manifest.entity?.parentOrganization?.name) warnings.push('Missing entity.parentOrganization.name (Machine Trust)');
  if (!manifest.entity?.parentOrganization?.legalEntity) warnings.push('Missing entity.parentOrganization.legalEntity');
  if (!manifest.endpoints?.catalog) errors.push('Missing endpoints.catalog');
  if (!manifest.endpoints?.negotiate) errors.push('Missing endpoints.negotiate');
  if (!manifest.endpoints?.checkout) errors.push('Missing endpoints.checkout');
  if (!manifest.paymentRails || !Object.values(manifest.paymentRails).some(r => r?.enabled)) {
    errors.push('No payment rails enabled in paymentRails config');
  }

  const score = Math.max(0, 100 - errors.length * 20 - warnings.length * 5);

  console.log('\n======================================================');
  console.log(`  UCP VALIDATION REPORT - SCORE: ${score >= 80 ? '\x1b[32m' : '\x1b[33m'}${score}/100\x1b[0m`);
  console.log('======================================================');
  console.log(`  Entity:              ${manifest.entity?.name || 'Unknown'}`);
  console.log(`  Parent Entity:       ${manifest.entity?.parentOrganization?.legalEntity || 'N/A'}`);
  console.log(`  Machine Trust Score: ${manifest.entity?.machineTrustScore ?? 'N/A'}`);
  console.log(`  Payment Rails:       ${Object.keys(manifest.paymentRails || {}).filter(k => manifest.paymentRails[k]?.enabled).join(', ')}`);
  console.log(`  Product Offers:      ${products.length}`);
  console.log('------------------------------------------------------');

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\x1b[32m  ✓ 100% Protocol Compliant! Ready for autonomous agent commerce.\x1b[0m');
  } else {
    for (const e of errors) {
      console.log(`  \x1b[31m[ERROR]\x1b[0m ${e}`);
    }
    for (const w of warnings) {
      console.log(`  \x1b[33m[WARN]\x1b[0m  ${w}`);
    }
  }
  console.log('======================================================\n');
}

async function handleServe(args) {
  const parsed = parseArgs(args);
  const port = parseInt(parsed.port || parsed.p || '4020', 10);
  const configFile = path.resolve(process.cwd(), parsed.config || parsed.c || 'ucp.config.json');

  let config;
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    } catch (e) {
      console.log(`\x1b[31m[x] Error reading ${configFile}: Invalid JSON\x1b[0m`);
      process.exit(1);
    }
  } else {
    console.log(`\x1b[33m[!] Config not found at ${configFile}. Using ephemeral in-memory config.\x1b[0m`);
    config = {
      manifest: {
        ucpVersion: '1.0.0',
        protocol: 'UCP/1.0',
        entity: {
          name: 'Nymrel UCP Dev Server',
          legalName: 'Nymrel',
          parentOrganization: { name: 'Nymrel', legalEntity: 'JalenBuilds LLC' },
          url: `http://localhost:${port}`,
          contactEmail: 'contact@nymrel.com',
          verified: true,
          machineTrustScore: 0.99
        },
        capabilities: {
          instantCheckout: true,
          machineNegotiation: true,
          x402Payments: true,
          ap2Protocol: true,
          dynamicPricing: true
        },
        endpoints: {
          catalog: '/api/ucp/catalog',
          negotiate: '/api/ucp/negotiate',
          quote: '/api/ucp/quote',
          checkout: '/api/ucp/checkout'
        },
        paymentRails: {
          x402: { enabled: true, payTo: '0x0000000000000000000000000000000000000000', acceptedTokens: ['USDC'], defaultNetwork: 'polygon' }
        },
        security: { signingAlgorithm: 'HMAC-SHA256', quoteTtlSeconds: 300 }
      },
      secretKey: 'dev_secret_key_nymrel_open_ucp_2026',
      products: [
        {
          sku: 'ai-compute-tier1',
          title: 'GPU Inference Capacity (100k Tokens)',
          description: 'High-throughput low-latency inference slot',
          basePrice: 0.10,
          currency: 'USD',
          unit: '100k_tokens',
          stockStatus: 'unlimited',
          pricingTiers: [
            { minQuantity: 1, unitPrice: 0.10, discountPercent: 0 },
            { minQuantity: 100, unitPrice: 0.085, discountPercent: 15 },
            { minQuantity: 500, unitPrice: 0.070, discountPercent: 30 }
          ],
          negotiationRules: { allowNegotiation: true, minAcceptablePrice: 0.05, maxDiscountPercent: 50 }
        }
      ]
    };
  }

  const productsMap = new Map();
  for (const p of config.products || []) {
    productsMap.set(p.sku, p);
  }

  const server = http.createServer(async (req, res) => {
    const method = req.method?.toUpperCase();
    const url = req.url?.split('?')[0];

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (method === 'GET' && (url === '/.well-known/ucp.json' || url === '/ucp.json')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(config.manifest, null, 2));
      return;
    }

    if (method === 'GET' && url === '/api/ucp/catalog') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        protocol: 'UCP/1.0',
        count: config.products?.length || 0,
        products: config.products || []
      }, null, 2));
      return;
    }

    if (method === 'POST' && url === '/api/ucp/negotiate') {
      let bodyStr = '';
      req.on('data', chunk => (bodyStr += chunk));
      req.on('end', () => {
        try {
          const body = JSON.parse(bodyStr);
          const product = productsMap.get(body.sku);
          if (!product) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `SKU '${body.sku}' not found` }));
            return;
          }

          const qty = Number(body.quantity) || 1;
          let unitPrice = product.basePrice;
          let discount = 0;

          if (product.pricingTiers) {
            for (const t of [...product.pricingTiers].sort((a, b) => b.minQuantity - a.minQuantity)) {
              if (qty >= t.minQuantity) {
                unitPrice = t.unitPrice;
                discount = t.discountPercent;
                break;
              }
            }
          }

          if (body.proposedPrice && product.negotiationRules?.allowNegotiation) {
            const prop = Number(body.proposedPrice);
            if (prop >= product.negotiationRules.minAcceptablePrice && prop < unitPrice) {
              unitPrice = prop;
              discount = Number((((product.basePrice - prop) / product.basePrice) * 100).toFixed(2));
            }
          }

          const totalPrice = Number((unitPrice * qty).toFixed(2));
          const quoteId = 'ucp_quote_' + crypto.randomBytes(8).toString('hex');
          const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();

          const signData = `${quoteId}:${product.sku}:${qty}:${totalPrice.toFixed(2)}:${product.currency.toUpperCase()}:${expiresAt}:${body.agentId || 'agent'}:${body.clientNonce || '0'}`;
          const signature = crypto.createHmac('sha256', config.secretKey || 'dev_key').update(signData).digest('hex');

          const quote = {
            quoteId,
            sku: product.sku,
            quantity: qty,
            unitPrice,
            totalPrice,
            currency: product.currency,
            discountPercent: discount,
            savings: Number(((product.basePrice * qty) - totalPrice).toFixed(2)),
            agentId: body.agentId || 'agent',
            clientNonce: body.clientNonce || '0',
            status: 'accepted',
            issuedAt: new Date().toISOString(),
            expiresAt,
            signature,
            settlementInstructions: {
              protocol: 'x402',
              payTo: config.manifest.paymentRails?.x402?.payTo,
              network: config.manifest.paymentRails?.x402?.defaultNetwork
            }
          };

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(quote, null, 2));
        } catch (e) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e.message || 'Invalid JSON' }));
        }
      });
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Endpoint not found', path: url }));
  });

  server.listen(port, () => {
    console.log(`\n\x1b[32m[✓] open-ucp Dev Server running on http://localhost:${port}\x1b[0m`);
    console.log(`    - Manifest:   http://localhost:${port}/.well-known/ucp.json`);
    console.log(`    - Catalog:    http://localhost:${port}/api/ucp/catalog`);
    console.log(`    - Negotiate:  http://localhost:${port}/api/ucp/negotiate`);
    console.log(`\n\x1b[36m    Ready for agent quote requests.\x1b[0m Press Ctrl+C to stop.\n`);
  });
}

async function handleInspect(args) {
  let target = args[0];
  if (!target) {
    console.log('\x1b[31m[x] Error: Must provide target URL to inspect. (e.g. open-ucp inspect https://example.com)\x1b[0m');
    return;
  }
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    target = 'https://' + target;
  }

  const manifestUrl = target.endsWith('/ucp.json') ? target : target.replace(/\/$/, '') + '/.well-known/ucp.json';
  console.log(`\x1b[36m[*] Fetching manifest from:\x1b[0m ${manifestUrl}`);

  try {
    const raw = await fetchHttp(manifestUrl);
    const manifest = JSON.parse(raw);

    console.log('\n======================================================');
    console.log(`  UCP INSPECTOR: ${manifest.entity?.name || 'Unknown'}`);
    console.log('======================================================');
    console.log(`  Protocol:            ${manifest.protocol || 'UCP/1.0'} (v${manifest.ucpVersion || '1.0.0'})`);
    console.log(`  Legal Entity:        ${manifest.entity?.legalName || 'N/A'}`);
    console.log(`  Parent Organization: ${manifest.entity?.parentOrganization?.name} (${manifest.entity?.parentOrganization?.legalEntity})`);
    console.log(`  Verified Trust:      ${manifest.entity?.verified ? '✓ VERIFIED' : 'UNVERIFIED'}`);
    console.log(`  Machine Trust Score: ${manifest.entity?.machineTrustScore ?? 'N/A'}`);
    console.log(`  Contact:             ${manifest.entity?.contactEmail}`);
    console.log('------------------------------------------------------');
    console.log(`  Endpoints:`);
    console.log(`    - Catalog:         ${manifest.endpoints?.catalog}`);
    console.log(`    - Negotiate:       ${manifest.endpoints?.negotiate}`);
    console.log(`    - Checkout:        ${manifest.endpoints?.checkout}`);
    console.log('------------------------------------------------------');
    console.log(`  Payment Rails:`);
    for (const [rail, cfg] of Object.entries(manifest.paymentRails || {})) {
      const c = cfg;
      console.log(`    - ${rail.toUpperCase()}: ${c?.enabled ? `Enabled (${c.defaultNetwork || c.version || ''})` : 'Disabled'}`);
    }
    console.log('======================================================\n');
  } catch (err) {
    console.log(`\x1b[31m[x] Inspection failed: ${err.message}\x1b[0m`);
  }
}

async function handleQuote(args) {
  const parsed = parseArgs(args);
  const sku = parsed.sku || 'ai-compute-tier1';
  const quantity = parseInt(parsed.qty || parsed.q || '100', 10);
  const proposedPrice = parsed.price ? parseFloat(parsed.price) : undefined;
  const endpoint = parsed.url || 'http://localhost:4020/api/ucp/negotiate';
  const agentId = parsed.agent || 'agent_alpha_01';

  console.log(`\x1b[36m[*] Requesting programmatic quote for SKU '${sku}' (Qty: ${quantity})...\x1b[0m`);

  const payload = {
    sku,
    quantity,
    agentId,
    clientNonce: crypto.randomBytes(6).toString('hex')
  };
  if (proposedPrice !== undefined) {
    payload.proposedPrice = proposedPrice;
  }

  try {
    const resRaw = await postHttp(endpoint, payload);
    const quote = JSON.parse(resRaw);

    console.log('\n======================================================');
    console.log('  UCP NEGOTIATED QUOTE RESULT');
    console.log('======================================================');
    console.log(`  Quote ID:     ${quote.quoteId}`);
    console.log(`  SKU:          ${quote.sku}`);
    console.log(`  Quantity:     ${quote.quantity}`);
    console.log(`  Unit Price:   ${quote.unitPrice} ${quote.currency}`);
    console.log(`  Total Price:  ${quote.totalPrice} ${quote.currency}`);
    console.log(`  Discount:     ${quote.discountPercent}% (Savings: ${quote.savings} ${quote.currency})`);
    console.log(`  Status:       \x1b[32m${quote.status.toUpperCase()}\x1b[0m`);
    console.log(`  Reason:       ${quote.reason || 'N/A'}`);
    console.log(`  Expires At:   ${quote.expiresAt}`);
    console.log(`  HMAC Sig:     ${quote.signature}`);
    console.log('======================================================\n');
  } catch (err) {
    console.log(`\x1b[31m[x] Quote negotiation request failed: ${err.message}\x1b[0m`);
  }
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    } else if (arg?.startsWith('-')) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

function fetchHttp(targetUrl) {
  return new Promise((resolve, reject) => {
    const client = targetUrl.startsWith('https://') ? https : http;
    client.get(targetUrl, res => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
}

function postHttp(targetUrl, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl);
    const client = urlObj.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(body);

    const req = client.request(
      targetUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data || res.statusMessage}`));
            return;
          }
          resolve(data);
        });
      }
    );

    req.on('error', err => reject(err));
    req.write(bodyStr);
    req.end();
  });
}

main().catch(err => {
  console.error('[!] Fatal CLI Error:', err);
  process.exit(1);
});
