/**
 * Universal Commerce Protocol (UCP) Validator Suite
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { UCPManifest, ValidationReport, ProductOffer, ValidationIssue } from '../core/types.js';
import { ManifestValidator } from './manifest-validator.js';
import { JsonLdParityValidator } from './jsonld-parity.js';
import { AP2ComplianceValidator } from './ap2-compliance.js';

export { ManifestValidator, JsonLdParityValidator, AP2ComplianceValidator };

export class UCPValidator {
  /**
   * Performs an end-to-end audit of a UCP Manifest, Product Catalog, and JSON-LD parity.
   */
  public static validate(options: {
    manifest: unknown;
    products?: ProductOffer[];
  }): ValidationReport {
    const manifestResult = ManifestValidator.validate(options.manifest);
    const issues: ValidationIssue[] = [...manifestResult.issues];

    let jsonLdParityScore = 100;
    if (options.products && options.products.length > 0) {
      let totalParity = 0;
      for (const product of options.products) {
        const pResult = JsonLdParityValidator.validateParity(product);
        issues.push(...pResult.issues);
        totalParity += pResult.parityScore;
      }
      jsonLdParityScore = Math.round(totalParity / options.products.length);
    }

    const manifestObj = options.manifest as Partial<UCPManifest> | undefined;
    const parentOrgVerified = Boolean(
      manifestObj?.entity?.parentOrganization?.name &&
      manifestObj?.entity?.parentOrganization?.legalEntity
    );

    const endpointsFunctional = Boolean(
      manifestObj?.endpoints?.catalog &&
      manifestObj?.endpoints?.negotiate &&
      manifestObj?.endpoints?.checkout
    );

    const paymentRailsConfigured = Boolean(
      manifestObj?.paymentRails &&
      Object.values(manifestObj.paymentRails).some(
        r => typeof r === 'object' && r !== null && (r as { enabled?: boolean }).enabled === true
      )
    );

    const ap2Compliance = Boolean(
      manifestObj?.paymentRails?.ap2?.enabled
    );

    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    let overallScore = Math.round(
      manifestResult.score * 0.6 + jsonLdParityScore * 0.4 - warnings.length * 2
    );
    if (overallScore < 0) overallScore = 0;
    if (overallScore > 100) overallScore = 100;

    return {
      valid: errors.length === 0,
      score: overallScore,
      issues,
      details: {
        manifestSchema: manifestResult.valid,
        entityTrust: Boolean(manifestObj?.entity?.verified),
        parentOrgVerified,
        endpointsFunctional,
        paymentRailsConfigured,
        jsonLdParityScore,
        ap2Compliance
      }
    };
  }
}
