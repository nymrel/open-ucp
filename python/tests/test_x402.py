"""
Unit tests for open_ucp X402 Payment Required Protocol (Python)
"""

import unittest
from datetime import datetime, timezone, timedelta
from open_ucp.x402 import X402PaymentHandler


class TestUCPX402(unittest.TestCase):
    def setUp(self):
        self.secret_key = "test_python_x402_secret_key"
        self.handler = X402PaymentHandler(
            secret_key=self.secret_key,
            pay_to="0xMerchantVaultAddress",
            default_network="polygon",
            default_currency="USD"
        )

    def test_create_challenge_and_headers(self):
        challenge, headers = self.handler.create_challenge(
            amount=75.50,
            quote_id="ucp_quote_py_99",
            description="Agent storage access"
        )

        self.assertEqual(challenge.amount, 75.50)
        self.assertEqual(challenge.currency, "USD")
        self.assertEqual(headers["X-402-Amount"], "75.50")
        self.assertEqual(headers["X-402-Pay-To"], "0xMerchantVaultAddress")
        self.assertEqual(headers["X-402-Quote-Id"], "ucp_quote_py_99")
        self.assertIn('X-402 realm="UCP"', headers["WWW-Authenticate"])

    def test_header_extraction(self):
        h1 = {"x-402-authorization": "x402_token_val_1"}
        self.assertEqual(self.handler.extract_payment_header(h1), "x402_token_val_1")

        h2 = {"authorization": "X-402 x402_token_val_2"}
        self.assertEqual(self.handler.extract_payment_header(h2), "x402_token_val_2")

        h3 = {"authorization": "Bearer x402_token_val_3"}
        self.assertEqual(self.handler.extract_payment_header(h3), "x402_token_val_3")

    def test_payment_proof_token_lifecycle(self):
        token = self.handler.create_payment_proof_token(
            quote_id="ucp_quote_py_99",
            amount=75.50,
            currency="USD",
            payer_id="agent_wallet_payer"
        )
        self.assertTrue(token.startswith("x402_"))

        verify_res = self.handler.verify_payment(token)
        self.assertTrue(verify_res.verified)
        self.assertEqual(verify_res.amount, 75.50)
        self.assertEqual(verify_res.currency, "USD")
        self.assertEqual(verify_res.payer_id, "agent_wallet_payer")
        self.assertTrue(verify_res.receipt_id.startswith("ucp_rcpt_"))

    def test_reject_expired_payment_token(self):
        expired_time = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        token = self.handler.create_payment_proof_token(
            quote_id="ucp_quote_py_99",
            amount=75.50,
            currency="USD",
            payer_id="agent_wallet_payer",
            expires_at=expired_time
        )
        verify_res = self.handler.verify_payment(token)
        self.assertFalse(verify_res.verified)
        self.assertIn("expired", verify_res.error)


if __name__ == "__main__":
    unittest.main()
