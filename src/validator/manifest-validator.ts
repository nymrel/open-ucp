/**
 * Universal Commerce Protocol (UCP) Manifest Validator
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { UCPManifest, ValidationIssue } from '../core/types.js';

export class ManifestValidator {
  /**
   * Validates a UCP Manifest object according to UCP 1.0 specifications.
   */
  public static validate(manifest: unknown): { valid: boolean; issues: ValidationIssue[]; score: number } {
    const issues: ValidationIssue[] = [];

    if (!manifest || typeof manifest !== 'object') {
      return {
        valid: false,
        issues: [{ path: '', message: 'Manifest must be a non-null JSON object', severity: 'error' }],
        score: 0
      };
    }

    const m = manifest as Partial<UCPManifest>;

    // Protocol & Version Check
    if (!m.ucpVersion) {
      issues.push({ path: 'ucpVersion', message: 'Missing ucpVersion (expected "1.0.0" or "1.x")', severity: 'error' });
    }
    if (!m.protocol || !m.protocol.startsWith('UCP/')) {
      issues.push({ path: 'protocol', message: 'Missing or invalid protocol identifier (expected "UCP/1.0")', severity: 'error' });
    }

    // Entity Trust Check
    if (!m.entity) {
      issues.push({ path: 'entity', message: 'Missing required entity block', severity: 'error' });
    } else {
      if (!m.entity.name) {
        issues.push({ path: 'entity.name', message: 'Entity name is required', severity: 'error' });
      }
      if (!m.entity.url) {
        issues.push({ path: 'entity.url', message: 'Entity canonical URL is required', severity: 'error' });
      }
      if (!m.entity.contactEmail) {
        issues.push({ path: 'entity.contactEmail', message: 'Entity contact email is required', severity: 'error' });
      }
      if (!m.entity.parentOrganization) {
        issues.push({
          path: 'entity.parentOrganization',
          message: 'Missing parentOrganization entity trust block (dual-audience machine trust requirement)',
          severity: 'warning'
        });
      } else {
        if (!m.entity.parentOrganization.name) {
          issues.push({ path: 'entity.parentOrganization.name', message: 'Parent organization name is required', severity: 'warning' });
        }
        if (!m.entity.parentOrganization.legalEntity) {
          issues.push({ path: 'entity.parentOrganization.legalEntity', message: 'Parent legal entity is required', severity: 'warning' });
        }
      }
    }

    // Capabilities Check
    if (!m.capabilities) {
      issues.push({ path: 'capabilities', message: 'Missing capabilities declaration', severity: 'error' });
    } else {
      if (typeof m.capabilities.instantCheckout !== 'boolean') {
        issues.push({ path: 'capabilities.instantCheckout', message: 'instantCheckout must be boolean', severity: 'error' });
      }
      if (typeof m.capabilities.machineNegotiation !== 'boolean') {
        issues.push({ path: 'capabilities.machineNegotiation', message: 'machineNegotiation must be boolean', severity: 'error' });
      }
      if (typeof m.capabilities.x402Payments !== 'boolean') {
        issues.push({ path: 'capabilities.x402Payments', message: 'x402Payments must be boolean', severity: 'error' });
      }
    }

    // Endpoints Check
    if (!m.endpoints) {
      issues.push({ path: 'endpoints', message: 'Missing endpoints configuration', severity: 'error' });
    } else {
      if (!m.endpoints.catalog) {
        issues.push({ path: 'endpoints.catalog', message: 'Catalog endpoint URL is required', severity: 'error' });
      }
      if (!m.endpoints.negotiate) {
        issues.push({ path: 'endpoints.negotiate', message: 'Negotiate endpoint URL is required', severity: 'error' });
      }
      if (!m.endpoints.checkout) {
        issues.push({ path: 'endpoints.checkout', message: 'Checkout endpoint URL is required', severity: 'error' });
      }
    }

    // Payment Rails Check
    if (!m.paymentRails) {
      issues.push({ path: 'paymentRails', message: 'Payment rails configuration missing', severity: 'error' });
    } else {
      const hasEnabledRail = Object.values(m.paymentRails).some(
        rail => typeof rail === 'object' && rail !== null && (rail as { enabled?: boolean }).enabled === true
      );
      if (!hasEnabledRail) {
        issues.push({ path: 'paymentRails', message: 'At least one payment rail (x402, ap2, stripe) must be enabled', severity: 'error' });
      }
    }

    // Security Check
    if (!m.security) {
      issues.push({ path: 'security', message: 'Security policy definition missing', severity: 'error' });
    } else {
      if (!m.security.signingAlgorithm) {
        issues.push({ path: 'security.signingAlgorithm', message: 'Signing algorithm must be specified (e.g. HMAC-SHA256)', severity: 'error' });
      }
      if (!m.security.quoteTtlSeconds || m.security.quoteTtlSeconds <= 0) {
        issues.push({ path: 'security.quoteTtlSeconds', message: 'quoteTtlSeconds must be a positive integer', severity: 'error' });
      }
    }

    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    let score = 100 - errors.length * 15 - warnings.length * 5;
    if (score < 0) score = 0;

    return {
      valid: errors.length === 0,
      issues,
      score
    };
  }
}
