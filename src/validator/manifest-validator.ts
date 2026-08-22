/**
 * Universal Commerce Protocol (UCP) Manifest Validator
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { UCPManifest, ValidationIssue } from '../core/types.js';

/** Endpoint fields that carry machine-action URLs (required trio + optional). */
const MACHINE_ACTION_ENDPOINT_KEYS = [
  'catalog',
  'negotiate',
  'quote',
  'checkout',
  'verifyPayment',
  'webhook'
] as const;

const REQUIRED_ENDPOINT_KEYS = ['catalog', 'negotiate', 'checkout'] as const;

interface UrlCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Octet-range check: true when private/reserved or malformed (fail closed).
 */
function isPrivateOctets(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 0 || a === 10 || a === 127) return true; // unspecified / private / loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  return false;
}

/**
 * IPv4-literal check: true when private/reserved or malformed (fail closed).
 */
function isPrivateOrMalformedIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return true;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return true;
    const n = Number(part);
    if (n > 255) return true;
    octets.push(n);
  }
  return isPrivateOctets(octets);
}

/**
 * True only for publicly resolvable hosts: rejects loopback, private,
 * link-local, and single-label intranet names.
 */
function isPublicHostname(rawHost: string): boolean {
  let host = rawHost.toLowerCase().trim();
  if (host.startsWith('[') && host.endsWith(']')) {
    // IPv6 literal
    const v6 = host.slice(1, -1);
    // IPv4-mapped tail, in dotted ("::ffff:10.0.0.1") or canonical hex
    // ("::ffff:a00:1" — WHATWG serializes mapped addresses this way) form.
    const mapped = v6.match(/^::ffff:([0-9a-f.:]+)$/);
    if (mapped) {
      const tail = mapped[1] ?? '';
      if (tail.includes('.')) return !isPrivateOrMalformedIpv4(tail);
      const groups = tail.split(':');
      if (groups.length === 2 && groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) {
        const hi = parseInt(groups[0] ?? '', 16);
        const lo = parseInt(groups[1] ?? '', 16);
        return !isPrivateOctets([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
      }
    }
    if (v6 === '::' || v6 === '::1') return false;
    const labels = v6.split(':');
    const firstLabel = labels.find(l => l.length > 0) ?? '';
    const hex = parseInt(firstLabel, 16);
    if (!Number.isNaN(hex)) {
      if (hex >= 0xfc00 && hex <= 0xfdff) return false; // unique local
      if (hex >= 0xfe80 && hex <= 0xfebf) return false; // link-local
    }
    return true;
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host.includes('.')) return false; // single-label host ("localhost", intranet names)
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^[\d.]+$/.test(host)) return !isPrivateOrMalformedIpv4(host); // dotted-quad literal
  return true;
}

/** Entity URL policy: public HTTPS absolute URL, no embedded credentials. */
function checkPublicHttpsUrl(value: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'not an absolute URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: `scheme must be https (got "${url.protocol.replace(/:$/, '')}")` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credential-bearing URLs are not allowed' };
  }
  if (!isPublicHostname(url.hostname)) {
    return { ok: false, reason: `"${url.hostname}" is not a publicly resolvable host` };
  }
  return { ok: true };
}

/**
 * Machine-action URL policy: a rooted relative path ("/api/...") resolved
 * against the serving origin, or an absolute HTTPS URL on the entity's
 * canonical origin. Rejects cross-origin, HTTP, protocol-relative,
 * credential-bearing, and malformed values. Fails closed when no canonical
 * origin can be established (invalid entity URL): absolute URLs are rejected,
 * while rooted relative paths remain evaluable.
 */
function checkMachineActionUrl(value: string, canonicalOrigin: string | null): UrlCheck {
  if (value.startsWith('//')) {
    return { ok: false, reason: 'protocol-relative URLs are ambiguous; use a rooted relative path or an absolute HTTPS URL on the entity origin' };
  }
  if (value.startsWith('/')) {
    if (/\s/.test(value)) {
      return { ok: false, reason: 'relative path must not contain whitespace' };
    }
    return { ok: true };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'malformed URL; use a rooted relative path ("/api/...") or an absolute HTTPS URL on the entity origin' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'absolute machine-action URLs must use HTTPS' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credential-bearing URLs are not allowed' };
  }
  if (!canonicalOrigin) {
    // Fail closed: without a valid entity URL no canonical origin can be
    // established, so absolute machine-action URLs cannot be pinned.
    return { ok: false, reason: 'canonical origin unavailable; absolute machine-action URLs require a valid public HTTPS entity URL' };
  }
  if (url.origin !== canonicalOrigin) {
    return { ok: false, reason: `cross-origin URLs are not allowed (expected origin ${canonicalOrigin})` };
  }
  return { ok: true };
}

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

    // Canonical origin, established from a valid entity URL; used to pin
    // machine-action URLs to the entity's own HTTPS origin.
    let canonicalOrigin: string | null = null;

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
      } else if (typeof m.entity.url !== 'string') {
        issues.push({ path: 'entity.url', message: 'Entity URL must be a string', severity: 'error' });
      } else {
        const check = checkPublicHttpsUrl(m.entity.url);
        if (!check.ok) {
          issues.push({
            path: 'entity.url',
            message: `Entity URL must be a public HTTPS absolute URL (${check.reason})`,
            severity: 'error'
          });
        } else {
          canonicalOrigin = new URL(m.entity.url).origin;
        }
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
      for (const key of REQUIRED_ENDPOINT_KEYS) {
        if (!(m.endpoints as unknown as Record<string, unknown>)[key]) {
          const label = key.charAt(0).toUpperCase() + key.slice(1);
          issues.push({ path: `endpoints.${key}`, message: `${label} endpoint URL is required`, severity: 'error' });
        }
      }
      for (const key of MACHINE_ACTION_ENDPOINT_KEYS) {
        const value = (m.endpoints as unknown as Record<string, unknown>)[key];
        if (value === undefined || value === null || value === '') continue;
        if (typeof value !== 'string') {
          issues.push({
            path: `endpoints.${key}`,
            message: 'Endpoint must be a rooted relative path or an HTTPS URL on the entity canonical origin',
            severity: 'error'
          });
          continue;
        }
        const check = checkMachineActionUrl(value, canonicalOrigin);
        if (!check.ok) {
          issues.push({
            path: `endpoints.${key}`,
            message: `Endpoint must be a rooted relative path or an HTTPS URL on the entity canonical origin (${check.reason})`,
            severity: 'error'
          });
        }
      }
    }

    // llms.txt Discoverability Check
    const llmsTxtUrl = (m as { llmsTxtUrl?: unknown }).llmsTxtUrl;
    if (typeof llmsTxtUrl === 'string' && llmsTxtUrl !== '') {
      const check = checkMachineActionUrl(llmsTxtUrl, canonicalOrigin);
      if (!check.ok) {
        issues.push({
          path: 'llmsTxtUrl',
          message: `llmsTxtUrl must be a rooted relative path or an HTTPS URL on the entity canonical origin (${check.reason})`,
          severity: 'error'
        });
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
