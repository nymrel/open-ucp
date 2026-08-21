"""
Unit tests for open_ucp Core Manifest, Product Catalog & JSON-LD (Python)
"""

import unittest
from open_ucp.core import UCPManifestBuilder, ProductCatalog, create_default_manifest
from open_ucp.types import ProductOffer, PricingTier, NegotiationRules


class TestUCPCore(unittest.TestCase):
    def test_manifest_builder_defaults(self):
        builder = UCPManifestBuilder()
        manifest = builder.build()

        self.assertEqual(manifest["ucpVersion"], "1.0.0")
        self.assertEqual(manifest["protocol"], "UCP/1.0")
        self.assertEqual(manifest["entity"]["name"], "Nymrel Platform")
        self.assertEqual(manifest["entity"]["parentOrganization"]["name"], "Nymrel")
        self.assertEqual(manifest["entity"]["parentOrganization"]["legalEntity"], "JalenBuilds LLC")
        self.assertTrue(manifest["entity"]["verified"])
        self.assertTrue(manifest["capabilities"]["machineNegotiation"])
        self.assertTrue(manifest["capabilities"]["x402Payments"])
        self.assertTrue(manifest["paymentRails"]["x402"]["enabled"])

    def test_create_default_manifest_customization(self):
        manifest = create_default_manifest(
            name="Alpha Agent Services",
            url="https://alpha.nymrel.com",
            contact_email="contact@nymrel.com",
            pay_to="0xAlphaVault12345"
        )
        self.assertEqual(manifest["entity"]["name"], "Alpha Agent Services")
        self.assertEqual(manifest["entity"]["url"], "https://alpha.nymrel.com")
        self.assertEqual(manifest["paymentRails"]["x402"]["payTo"], "0xAlphaVault12345")

    def test_product_catalog_crud_and_jsonld(self):
        catalog = ProductCatalog()
        product = ProductOffer(
            sku="gpu-h100-hour",
            title="NVIDIA H100 SXM5 Instance (1 Hour)",
            description="Dedicated 80GB VRAM compute node",
            base_price=3.50,
            currency="USD",
            unit="hour",
            stock_status="in_stock",
            category="Compute",
            pricing_tiers=[
                PricingTier(min_quantity=1, unit_price=3.50, discount_percent=0.0),
                PricingTier(min_quantity=10, unit_price=3.00, discount_percent=14.29),
                PricingTier(min_quantity=100, unit_price=2.50, discount_percent=28.57)
            ],
            negotiation_rules=NegotiationRules(
                allow_negotiation=True,
                min_acceptable_price=2.20,
                max_discount_percent=37.14
            )
        )
        catalog.add_product(product)

        self.assertEqual(len(catalog.get_all_products()), 1)
        self.assertIsNotNone(catalog.get_product("gpu-h100-hour"))
        self.assertEqual(len(catalog.search("H100")), 1)
        self.assertEqual(len(catalog.get_by_category("Compute")), 1)

        summary = catalog.get_summary()
        self.assertEqual(summary["productCount"], 1)
        self.assertEqual(summary["categories"], ["Compute"])

        json_ld_list = catalog.export_json_ld_list()
        self.assertEqual(len(json_ld_list), 1)
        self.assertEqual(json_ld_list[0]["@type"], "Product")
        self.assertEqual(json_ld_list[0]["offers"]["price"], 3.50)


if __name__ == "__main__":
    unittest.main()
