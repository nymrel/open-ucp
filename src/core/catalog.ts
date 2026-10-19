/**
 * Universal Commerce Protocol (UCP) Product & Offer Catalog Engine
 * 
 * Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 */

import { ProductOffer, CatalogSummary } from './types.js';

export class ProductCatalog {
  private products: Map<string, ProductOffer> = new Map();

  constructor(initialProducts?: ProductOffer[]) {
    if (initialProducts) {
      this.addProducts(initialProducts);
    }
  }

  public addProduct(product: ProductOffer): this {
    if (!product.sku) {
      throw new Error('Product must have a unique SKU identifier.');
    }
    this.products.set(product.sku, {
      ...product,
      stockStatus: product.stockStatus || 'in_stock',
      pricingTiers: product.pricingTiers || [],
      deliveryMethods: product.deliveryMethods || ['instant_api', 'digital_download'],
      jsonLd: product.jsonLd || this.generateJsonLd(product)
    });
    return this;
  }

  public addProducts(products: ProductOffer[]): this {
    for (const product of products) {
      this.addProduct(product);
    }
    return this;
  }

  public getProduct(sku: string): ProductOffer | undefined {
    return this.products.get(sku);
  }

  public hasProduct(sku: string): boolean {
    return this.products.has(sku);
  }

  public getAllProducts(): ProductOffer[] {
    return Array.from(this.products.values());
  }

  public getByCategory(category: string): ProductOffer[] {
    const target = category.toLowerCase();
    return this.getAllProducts().filter(p => p.category?.toLowerCase() === target);
  }

  public search(query: string): ProductOffer[] {
    const q = query.toLowerCase();
    return this.getAllProducts().filter(
      p =>
        p.sku.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q)
    );
  }

  public removeProduct(sku: string): boolean {
    return this.products.delete(sku);
  }

  public clear(): void {
    this.products.clear();
  }

  public getSummary(): CatalogSummary {
    const all = this.getAllProducts();
    const categories = Array.from(
      new Set(all.map(p => p.category).filter((c): c is string => Boolean(c)))
    );
    const currency = all.length > 0 ? all[0]?.currency || 'USD' : 'USD';
    return {
      productCount: all.length,
      categories,
      currency
    };
  }

  public generateJsonLd(product: ProductOffer): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      description: product.description,
      sku: product.sku,
      offers: {
        '@type': 'Offer',
        price: product.basePrice,
        priceCurrency: product.currency,
        availability:
          product.stockStatus === 'in_stock' || product.stockStatus === 'unlimited'
            ? 'https://schema.org/InStock'
            : product.stockStatus === 'preorder'
            ? 'https://schema.org/PreOrder'
            : 'https://schema.org/OutOfStock',
        priceValidUntil: new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0],
        seller: {
          '@type': 'Organization',
          name: 'Nymrel',
          legalName: 'JalenBuilds LLC'
        }
      }
    };
  }

  public exportJsonLdList(): Record<string, unknown>[] {
    return this.getAllProducts().map(p => p.jsonLd || this.generateJsonLd(p));
  }
}
