"""Adapter, receipt and cross-language regressions for dhyabi2's Nano rail."""
import asyncio
import copy
import json
from pathlib import Path
import unittest
from open_ucp import (
    NegotiationEngine, ProductCatalog, ProductOffer, QuoteRequest, SignedQuote,
    X402PaymentHandler, UCPFastAPIMiddleware, InMemoryNanoReceiptLedger,
    create_default_manifest, xno_to_raw, verify_nano_receipt, NegotiationRules,
)

PAYTO = "nano_test_merchant"
SEND = "A" * 64
RECEIVE = "B" * 64
SECRET = "nano-adapter-regression-secret"


async def lookup(block_hash):
    return {
        "exists": True, "confirmed": True, "hash": block_hash,
        "subtype": "send" if block_hash.upper() == SEND else "receive",
        "blockAccount": PAYTO, "linkAsAccount": PAYTO,
        "sourceHash": SEND, "amountRaw": xno_to_raw("1")
    }


class TestNano(unittest.TestCase):
    def test_exact_conversion(self):
        for amount, expected in [(0.00001, str(10 ** 25)), (1e-7, str(10 ** 23)),
                                 ("1.000000000000000000000000000001", str(10 ** 30 + 1)),
                                 ("0.5" + "0" * 35, str(5 * 10 ** 29)), (1e-30, "1")]:
            self.assertEqual(xno_to_raw(amount), expected)
        for invalid in ["", ".", "abc", -1, float("nan"), float("inf"), "1e-31", "1e999999"]:
            with self.assertRaises(ValueError):
                xno_to_raw(invalid)

    def test_shared_quote_fixtures(self):
        fixture = Path(__file__).resolve().parents[2] / "test/fixtures/nano-quotes.json"
        data = json.loads(fixture.read_text())
        engine = NegotiationEngine(secret_key=data["secret"])
        for case in data["cases"]:
            quote = SignedQuote.from_dict(case["quote"])
            self.assertTrue(engine.verify_quote(quote)["valid"], case["name"])
            for field in ["payTo", "protocol", "network", "token", "checkoutUrl"]:
                tampered = copy.deepcopy(quote)
                tampered.settlement_instructions[field] = "attacker"
                self.assertFalse(engine.verify_quote(tampered)["valid"])
            quote.total_price = "0.000000000000000000000000000002" if quote.currency == "XNO" else 11
            self.assertFalse(engine.verify_quote(quote)["valid"])

    def test_precise_quotes(self):
        engine = NegotiationEngine(secret_key=SECRET, pay_to=PAYTO, network="nano")
        request = QuoteRequest("micro", 3, "agent", "nonce")
        product = ProductOffer("micro", "Micro", "tiny", 0.00001, currency="XNO")
        quote = engine.create_quote(request, product)
        self.assertEqual(quote.total_price, "0.00003")
        self.assertTrue(engine.verify_quote(quote)["valid"])
        product.base_price = 0.1
        self.assertEqual(engine.create_quote(request, product).total_price, "0.3")
        product.base_price = 0.00001
        product.negotiation_rules = NegotiationRules(min_acceptable_price=0.000005)
        request.proposed_price = 0.000006
        request.quantity = 10
        curve = engine.create_quote(request, product)
        self.assertGreater(float(curve.total_price), 0)
        self.assertTrue(engine.verify_quote(curve)["valid"])
        product.negotiation_rules = None
        product.base_price = 1e-30
        request.quantity = 0.5
        with self.assertRaises(ValueError):
            engine.create_quote(request, product)

    def test_precise_challenge(self):
        handler = X402PaymentHandler(SECRET, default_currency="XNO", default_network="nano")
        self.assertEqual(handler.create_challenge(1e-7)[1]["X-402-Amount"], "0.0000001")


class TestNanoReceipts(unittest.IsolatedAsyncioTestCase):
    async def test_send_receive_normalization_and_replay(self):
        handler = X402PaymentHandler(SECRET, pay_to=PAYTO, nano_rpc_lookup=lookup)
        first = await handler.verify_nano_settlement(tx_hash=SEND.lower(), amount_xno="0.00001", quote_id="q1")
        second = await handler.verify_nano_settlement(tx_hash=RECEIVE, amount_xno="0.00001", quote_id="q2")
        self.assertTrue(first.verified)
        self.assertEqual(first.amount, "0.00001")
        self.assertFalse(second.verified)

    async def test_fail_closed_receipts(self):
        valid = await lookup(RECEIVE)
        for patch in [
            {"exists": False}, {"confirmed": False}, {"subtype": "change"},
            {"blockAccount": "nano_other"}, {"blockAccount": None}, {"sourceHash": None},
            {"amountRaw": "1"}, {"amountRaw": "1.5"}, {"amountRaw": None},
        ]:
            async def bad_lookup(_):
                return {**valid, **patch}
            result = await verify_nano_receipt(RECEIVE, PAYTO, xno_to_raw("0.00001"), bad_lookup)
            self.assertFalse(result["verified"], patch)
        async def outgoing(_):
            return {**valid, "subtype": "send", "blockAccount": PAYTO, "linkAsAccount": "nano_other"}
        self.assertFalse((await verify_nano_receipt(SEND, PAYTO, "1", outgoing))["verified"])

    async def test_fail_closed_handler(self):
        handler = X402PaymentHandler(SECRET, pay_to=PAYTO, nano_rpc_lookup=lookup)
        for options in [{"currency": "USD"}, {"amount_xno": 0}, {"quote_id": ""},
                        {"tx_hash": "bad"}, {"pay_to": "0x0"}]:
            result = await handler.verify_nano_settlement(**{
                "tx_hash": SEND, "amount_xno": "0.00001", "quote_id": "q1", **options
            })
            self.assertFalse(result.verified)
        class BrokenLedger:
            def claim(self, payment_id, quote_id):
                raise RuntimeError("store offline")
        handler.nano_receipt_ledger = BrokenLedger()
        self.assertFalse((await handler.verify_nano_settlement(
            tx_hash=SEND, amount_xno="0.00001", quote_id="q1")).verified)


class TestNanoASGI(unittest.IsolatedAsyncioTestCase):
    def middleware(self, **options):
        manifest = create_default_manifest()
        manifest["paymentRails"]["x402"].update({"payTo": PAYTO, "defaultNetwork": "nano"})
        manifest["catalogSummary"]["currency"] = "XNO"
        catalog = ProductCatalog()
        catalog.add_product(ProductOffer("micro", "Micro", "tiny", 0.00001, currency="XNO"))
        async def app(scope, receive, send):
            raise AssertionError("should be intercepted")
        return UCPFastAPIMiddleware(app, manifest, catalog, SECRET, nano_rpc_lookup=lookup, **options)

    async def post(self, middleware, path, payload):
        messages = []
        async def receive():
            return {"type": "http.request", "body": json.dumps(payload).encode(), "more_body": False}
        async def send(message):
            messages.append(message)
        await middleware({"type": "http", "method": "POST", "path": "/api/ucp/" + path}, receive, send)
        return messages[0]["status"], json.loads(messages[1]["body"])

    async def test_shared_ledger_negotiate_checkout_and_restart(self):
        ledger = InMemoryNanoReceiptLedger()
        fulfilled = []
        async def fulfill(value):
            fulfilled.append(value)
            return {"delivered": True}
        a = self.middleware(nano_receipt_ledger=ledger, on_checkout_complete=fulfill)
        b = self.middleware(nano_receipt_ledger=ledger, on_checkout_complete=fulfill)
        request = {"sku": "micro", "quantity": 3, "agentId": "agent", "clientNonce": "n"}
        _, quote = await self.post(a, "negotiate", request)
        _, other_quote = await self.post(b, "negotiate", request)
        self.assertEqual(quote["totalPrice"], "0.00003")
        first, second = await asyncio.gather(
            self.post(a, "checkout", {"quote": quote, "paymentProof": {"txHash": SEND}}),
            self.post(b, "checkout", {"quote": other_quote, "paymentProof": {"txHash": RECEIVE}}))
        self.assertEqual(sorted([first[0], second[0]]), [200, 402])
        self.assertEqual(len(fulfilled), 1)
        self.assertEqual(fulfilled[0]["amount"], "0.00003")
        restarted = self.middleware(nano_receipt_ledger=ledger, on_checkout_complete=fulfill)
        self.assertEqual((await self.post(restarted, "checkout", {
            "quote": quote, "paymentProof": {"txHash": RECEIVE}}))[0], 402)
        tampered = {**quote, "totalPrice": "0.000030000000000000000000000001"}
        self.assertEqual((await self.post(a, "checkout", {
            "quote": tampered, "paymentProof": {"txHash": "C" * 64}}))[0], 422)

    async def test_missing_or_failed_payment_does_not_fulfill(self):
        middleware = self.middleware()
        _, quote = await self.post(middleware, "negotiate", {
            "sku": "micro", "quantity": 1, "agentId": "agent", "clientNonce": "n"})
        self.assertEqual((await self.post(middleware, "checkout", {
            "quote": quote, "paymentProof": {"token": "wrong-rail"}}))[0], 402)
        tampered = {**quote, "settlementInstructions": {**quote["settlementInstructions"], "payTo": "nano_other"}}
        self.assertEqual((await self.post(middleware, "checkout", {
            "quote": tampered, "paymentProof": {"txHash": SEND}}))[0], 422)
