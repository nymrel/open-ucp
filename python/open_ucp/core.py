"""
Universal Commerce Protocol (UCP) Core Manifest & Product Catalog Engine (Python)

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta
import json
from .types import (
    EntityTrust,
    ParentOrganization,
    UCPCapabilities,
    UCPEndpoints,
    ProductOffer,
    PricingTier,
    NegotiationRules
)


class UCPManifestBuilder:
    def __init__(self, base_manifest: Optional[Dict[str, Any]] = None):
        self._manifest: Dict[str, Any] = {
            "ucpVersion": "1.0.0",
            "protocol": "UCP/1.0",
            "entity": EntityTrust().to_dict(),
            "capabilities": UCPCapabilities().to_dict(),
            "endpoints": UCPEndpoints().to_dict(),
            "paymentRails": {
                "x402": {
                    "enabled": True,
                    "payTo": "0x0000000000000000000000000000000000000000",
                    "acceptedTokens": ["USDC", "USD", "SAT"],
                    "defaultNetwork": "polygon"
                },
                "ap2": {
                    "enabled": True,
                    "version": "2.0",
                    "supportedAuthorities": ["nymrel.auth", "agent.id"]
                }
            },
            "catalogSummary": {
                "productCount": 0,
                "categories": [],
                "currency": "USD"
            },
            "security": {
                "signingAlgorithm": "HMAC-SHA256",
                "quoteTtlSeconds": 300,
                "rateLimits": {
                    "negotiationsPerMinute": 60,
                    "quotesPerHour": 500
                }
            },
            "llmsTxtUrl": "/llms.txt",
            "jsonLdContext": "https://schema.org",
            "updatedAt": datetime.now(timezone.utc).isoformat()
        }
        if base_manifest:
            self._manifest.update(base_manifest)

    def set_entity(self, **kwargs) -> "UCPManifestBuilder":
        self._manifest["entity"].update(kwargs)
        return self

    def set_capabilities(self, **kwargs) -> "UCPManifestBuilder":
        self._manifest["capabilities"].update(kwargs)
        return self

    def set_endpoints(self, **kwargs) -> "UCPManifestBuilder":
        self._manifest["endpoints"].update(kwargs)
        return self

    def set_payment_rails(self, rails: Dict[str, Any]) -> "UCPManifestBuilder":
        self._manifest["paymentRails"].update(rails)
        return self

    def set_security(self, **kwargs) -> "UCPManifestBuilder":
        self._manifest["security"].update(kwargs)
        return self

    def build(self) -> Dict[str, Any]:
        self._manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
        return dict(self._manifest)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.build(), indent=indent)


class ProductCatalog:
    def __init__(self, initial_products: Optional[List[ProductOffer]] = None):
        self._products: Dict[str, ProductOffer] = {}
        if initial_products:
            self.add_products(initial_products)

    def add_product(self, product: ProductOffer) -> "ProductCatalog":
        if not product.sku:
            raise ValueError("Product must have a unique SKU identifier.")
        if not product.json_ld:
            product.json_ld = self.generate_json_ld(product)
        self._products[product.sku] = product
        return self

    def add_products(self, products: List[ProductOffer]) -> "ProductCatalog":
        for p in products:
            self.add_product(p)
        return self

    def get_product(self, sku: str) -> Optional[ProductOffer]:
        return self._products.get(sku)

    def get_all_products(self) -> List[ProductOffer]:
        return list(self._products.values())

    def get_by_category(self, category: str) -> List[ProductOffer]:
        target = category.lower()
        return [p for p in self.get_all_products() if p.category and p.category.lower() == target]

    def search(self, query: str) -> List[ProductOffer]:
        q = query.lower()
        return [
            p for p in self.get_all_products()
            if q in p.sku.lower() or q in p.title.lower() or q in p.description.lower() or (p.category and q in p.category.lower())
        ]

    def get_summary(self) -> Dict[str, Any]:
        all_p = self.get_all_products()
        categories = list({p.category for p in all_p if p.category})
        currency = all_p[0].currency if all_p else "USD"
        return {
            "productCount": len(all_p),
            "categories": categories,
            "currency": currency
        }

    def generate_json_ld(self, product: ProductOffer) -> Dict[str, Any]:
        valid_until = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
        availability = "https://schema.org/InStock"
        if product.stock_status == "preorder":
            availability = "https://schema.org/PreOrder"
        elif product.stock_status == "out_of_stock":
            availability = "https://schema.org/OutOfStock"

        return {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": product.title,
            "description": product.description,
            "sku": product.sku,
            "offers": {
                "@type": "Offer",
                "price": product.base_price,
                "priceCurrency": product.currency,
                "availability": availability,
                "priceValidUntil": valid_until,
                "seller": {
                    "@type": "Organization",
                    "name": "Nymrel",
                    "parentOrganization": {
                        "@type": "Organization",
                        "name": "JalenBuilds LLC"
                    }
                }
            }
        }

    def export_json_ld_list(self) -> List[Dict[str, Any]]:
        return [p.json_ld or self.generate_json_ld(p) for p in self.get_all_products()]


def create_default_manifest(
    name: Optional[str] = None,
    url: Optional[str] = None,
    contact_email: Optional[str] = None,
    pay_to: Optional[str] = None
) -> Dict[str, Any]:
    builder = UCPManifestBuilder()
    if name or url or contact_email:
        builder.set_entity(
            name=name or "Nymrel Merchant",
            url=url or "https://example.com",
            contactEmail=contact_email or "contact@jalenbuilds.com"
        )
    if pay_to:
        builder.set_payment_rails({
            "x402": {
                "enabled": True,
                "payTo": pay_to,
                "acceptedTokens": ["USDC", "USD"],
                "defaultNetwork": "polygon"
            }
        })
    return builder.build()
