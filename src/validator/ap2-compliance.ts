/**
 * Universal Commerce Protocol (UCP) - AP2 Protocol Compliance Validator
 * Validates Agentic Purchasing Protocol v2 authorization payloads and headers
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { ValidationIssue } from '../core/types.js';

export interface AP2Payload {
  version: string;
  agentId: string;
  authority: string;
  nonce: string;
  timestamp: string | number;
  signature: string;
  scope?: string[];
  maxSpend?: {
    amount: number;
    currency: string;
  };
}

export class AP2ComplianceValidator {
  /**
   * Validates an AP2 authorization payload for protocol compliance.
   */
  public static validate(payload: unknown): { valid: boolean; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];

    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        issues: [{ path: '', message: 'AP2 payload must be a non-null JSON object', severity: 'error' }]
      };
    }

    const p = payload as Partial<AP2Payload>;

    if (!p.version || (!p.version.startsWith('2.') && p.version !== '2.0')) {
      issues.push({ path: 'version', message: 'AP2 version must be 2.0 or 2.x', severity: 'error' });
    }

    if (!p.agentId) {
      issues.push({ path: 'agentId', message: 'agentId identifier is required', severity: 'error' });
    }

    if (!p.authority) {
      issues.push({ path: 'authority', message: 'authority issuer (e.g. nymrel.auth) is required', severity: 'error' });
    }

    if (!p.nonce || p.nonce.length < 8) {
      issues.push({ path: 'nonce', message: 'Cryptographic nonce must be at least 8 characters', severity: 'error' });
    }

    if (!p.timestamp) {
      issues.push({ path: 'timestamp', message: 'Timestamp is required', severity: 'error' });
    } else {
      const ts = typeof p.timestamp === 'string' ? new Date(p.timestamp).getTime() : p.timestamp;
      if (isNaN(ts)) {
        issues.push({ path: 'timestamp', message: 'Timestamp format is invalid', severity: 'error' });
      } else {
        const diffMs = Math.abs(Date.now() - ts);
        // Warning if older than 1 hour
        if (diffMs > 3600 * 1000) {
          issues.push({ path: 'timestamp', message: 'Timestamp is older than 1 hour (replay risk)', severity: 'warning' });
        }
      }
    }

    if (!p.signature || p.signature.length < 32) {
      issues.push({ path: 'signature', message: 'Cryptographic signature is required', severity: 'error' });
    }

    const errors = issues.filter(i => i.severity === 'error');

    return {
      valid: errors.length === 0,
      issues
    };
  }
}
