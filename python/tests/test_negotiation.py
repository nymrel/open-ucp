"""
Unit tests for open_ucp Machine Negotiation Engine (Python)
"""

import unittest
from open_ucp.negotiation import NegotiationEngine
from open_ucp.types import QuoteRequest, ProductOffer, PricingTier, NegotiationRules


class TestUCPNegotiation(unittest.TestCase):
    def setUp(self):
        self.secret_key = "test_python_negotiation_secret_key"
        self.engine = NegotiationEngine(
            secret_key=self.secret_key,
            default_ttl_seconds=180,
            pay_to="0xPyVault",
            network="polygon"
        )
        self.product = ProductOffer(
            sku="llm-api-batch",
            title="Batch LLM Completion Slot",
            description="100k Token completion window",
            base_price=0.20,
            currency="USD",
            unit="batch",
            stock_status="in_stock",
            pricing_tiers=[
                PricingTier(min_quantity=1, unit_price=0.20, discount_percent=0.0),
                PricingTier(min_quantity=50, unit_price=0.16, discount_percent=20.0),
                PricingTier(min_quantity=500, unit_price=0.12, discount_percent=40.0)
            ],
            negotiation_rules=NegotiationRules(
                allow_negotiation=True,
                min_acceptable_price=0.10,
                max_discount_percent=50.0,
                volume_sensitivity=0.8,
                auto_accept_threshold=0.15
            )
        )

    def test_volume_tier_automatic_pricing(self):
        req = QuoteRequest(
            sku="llm-api-batch",
            quantity=100,
            agent_id="agent_py_01",
            client_nonce="nonce_abc"
        )
        quote = self.engine.create_quote(req, self.product)

        self.assertEqual(quote.status, "accepted")
        self.assertEqual(quote.unit_price, 0.16)
        self.assertEqual(quote.total_price, 16.00)
        self.assertEqual(quote.discount_percent, 20.0)
        self.assertTrue(bool(quote.signature))

    def test_auto_accept_negotiation(self):
        req = QuoteRequest(
            sku="llm-api-batch",
            quantity=10,
            agent_id="agent_py_01",
            client_nonce="nonce_def",
            proposed_price=0.15
        )
        quote = self.engine.create_quote(req, self.product)

        self.assertEqual(quote.status, "accepted")
        self.assertEqual(quote.unit_price, 0.15)
        self.assertEqual(quote.total_price, 1.50)

    def test_counter_offer_margin_curve(self):
        req = QuoteRequest(
            sku="llm-api-batch",
            quantity=10,
            agent_id="agent_py_01",
            client_nonce="nonce_ghi",
            proposed_price=0.11
        )
        quote = self.engine.create_quote(req, self.product)

        self.assertEqual(quote.status, "counter_offer")
        self.assertGreaterEqual(quote.unit_price, 0.10)
        self.assertIn("Counter-offer", quote.reason)

    def test_minimum_floor_enforcement(self):
        req = QuoteRequest(
            sku="llm-api-batch",
            quantity=10,
            agent_id="agent_py_01",
            client_nonce="nonce_jkl",
            proposed_price=0.02
        )
        quote = self.engine.create_quote(req, self.product)

        self.assertEqual(quote.status, "counter_offer")
        self.assertEqual(quote.unit_price, 0.10)
        self.assertEqual(quote.total_price, 1.00)

    def test_cryptographic_verification(self):
        req = QuoteRequest(
            sku="llm-api-batch",
            quantity=20,
            agent_id="agent_py_01",
            client_nonce="nonce_mno"
        )
        quote = self.engine.create_quote(req, self.product)
        verify_res = self.engine.verify_quote(quote)

        self.assertTrue(verify_res["valid"])
        self.assertFalse(verify_res["isExpired"])

        # Tampered quote
        quote.total_price = 0.01
        tampered_res = self.engine.verify_quote(quote)
        self.assertFalse(tampered_res["valid"])
        self.assertIn("signature mismatch", tampered_res["reason"])


if __name__ == "__main__":
    unittest.main()
