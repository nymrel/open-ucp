/**
 * @nymrel/open-ucp
 * Zero-dependency Universal Commerce Protocol (UCP) & Agentic Purchasing Engine
 * Standard Specification: UCP 1.0.0
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

// Core Exports
export * from './core/types.js';
export { UCPManifestBuilder, createDefaultManifest } from './core/manifest.js';
export { ProductCatalog } from './core/catalog.js';
export { X402PaymentHandler, X402Options } from './core/x402.js';

// Negotiation Engine Exports
export { NegotiationEngine } from './negotiation/engine.js';
export { NegotiationEngineOptions } from './negotiation/types.js';

// Validator Suite Exports
export {
  UCPValidator,
  ManifestValidator,
  JsonLdParityValidator,
  AP2ComplianceValidator
} from './validator/index.js';

// Framework Adapters
export {
  ucpExpressMiddleware,
  requireX402,
  UCPServerConfig,
  ExpressNextFunction
} from './adapters/express.js';

export {
  createUCPAppRouter,
  withX402
} from './adapters/nextjs.js';
