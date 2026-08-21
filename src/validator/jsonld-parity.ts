/**
 * Universal Commerce Protocol (UCP) JSON-LD Parity Validator
 * Ensures parity between Schema.org JSON-LD microdata and UCP catalog offers
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { ProductOffer, ValidationIssue } from '../core/types.js';

export class JsonLdParityValidator {
  /**
   * Validates that JSON-LD product data matches the UCP ProductOffer structure.
   */
  public static validateParity(
    product: ProductOffer,
    jsonLd?: Record<string, unknown>
  ): { valid: boolean; issues: ValidationIssue[]; parityScore: number } {
    const issues: ValidationIssue[] = [];
    const targetJsonLd = jsonLd || product.jsonLd;

    if (!targetJsonLd) {
      issues.push({
        path: `products[${product.sku}].jsonLd`,
        message: 'No Schema.org JSON-LD microdata found for product',
        severity: 'warning'
      });
      return { valid: true, issues, parityScore: 50 };
    }

    if (targetJsonLd['@type'] !== 'Product') {
      issues.push({
        path: `products[${product.sku}].jsonLd['@type']`,
        message: `Expected @type 'Product', found '${targetJsonLd['@type']}'`,
        severity: 'error'
      });
    }

    if (targetJsonLd['name'] !== product.title) {
      issues.push({
        path: `products[${product.sku}].jsonLd.name`,
        message: `JSON-LD name '${targetJsonLd['name']}' does not match product title '${product.title}'`,
        severity: 'warning'
      });
    }

    if (targetJsonLd['sku'] && targetJsonLd['sku'] !== product.sku) {
      issues.push({
        path: `products[${product.sku}].jsonLd.sku`,
        message: `JSON-LD sku '${targetJsonLd['sku']}' does not match product sku '${product.sku}'`,
        severity: 'error'
      });
    }

    const offers = targetJsonLd['offers'] as Record<string, unknown> | undefined;
    if (!offers) {
      issues.push({
        path: `products[${product.sku}].jsonLd.offers`,
        message: 'Missing offers block in JSON-LD',
        severity: 'error'
      });
    } else {
      if (offers['@type'] !== 'Offer') {
        issues.push({
          path: `products[${product.sku}].jsonLd.offers['@type']`,
          message: `Expected offers @type 'Offer', found '${offers['@type']}'`,
          severity: 'warning'
        });
      }
      if (Number(offers['price']) !== product.basePrice) {
        issues.push({
          path: `products[${product.sku}].jsonLd.offers.price`,
          message: `JSON-LD price ${offers['price']} does not match UCP basePrice ${product.basePrice}`,
          severity: 'error'
        });
      }
      if (String(offers['priceCurrency']).toUpperCase() !== product.currency.toUpperCase()) {
        issues.push({
          path: `products[${product.sku}].jsonLd.offers.priceCurrency`,
          message: `JSON-LD currency ${offers['priceCurrency']} does not match UCP currency ${product.currency}`,
          severity: 'error'
        });
      }
    }

    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    let parityScore = 100 - errors.length * 30 - warnings.length * 10;
    if (parityScore < 0) parityScore = 0;

    return {
      valid: errors.length === 0,
      issues,
      parityScore
    };
  }
}
