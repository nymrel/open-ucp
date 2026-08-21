"""
Universal Commerce Protocol (UCP) - FastAPI / ASGI Middleware Adapter (Python)

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

import json
from typing import Dict, Any, Callable, Optional, Awaitable, List
from .core import ProductCatalog
from .negotiation import NegotiationEngine
from .x402 import X402PaymentHandler
from .types import QuoteRequest


class UCPFastAPIMiddleware:
    """
    ASGI-compatible middleware for FastAPI / Starlette that intercepts UCP requests:
      - GET  /.well-known/ucp.json
      - GET  /api/ucp/catalog
      - POST /api/ucp/negotiate
      - POST /api/ucp/checkout
    """

    def __init__(
        self,
        app: Any,
        manifest: Dict[str, Any],
        catalog: ProductCatalog,
        secret_key: str,
        on_checkout_complete: Optional[Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]] = None
    ):
        self.app = app
        self.manifest = manifest
        self.catalog = catalog
        self.secret_key = secret_key
        self.on_checkout_complete = on_checkout_complete

        self.negotiation_engine = NegotiationEngine(
            secret_key=secret_key,
            default_ttl_seconds=manifest.get("security", {}).get("quoteTtlSeconds", 300),
            pay_to=manifest.get("paymentRails", {}).get("x402", {}).get("payTo"),
            network=manifest.get("paymentRails", {}).get("x402", {}).get("defaultNetwork")
        )

        self.payment_handler = X402PaymentHandler(
            secret_key=secret_key,
            pay_to=manifest.get("paymentRails", {}).get("x402", {}).get("payTo", "0x0"),
            default_network=manifest.get("paymentRails", {}).get("x402", {}).get("defaultNetwork", "polygon"),
            default_currency=manifest.get("catalogSummary", {}).get("currency", "USD")
        )

    async def __call__(self, scope: Dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope["method"].upper()
        path = scope["path"]

        # 1. Manifest
        if method == "GET" and path in ["/.well-known/ucp.json", "/ucp.json"]:
            dynamic = dict(self.manifest)
            dynamic["catalogSummary"] = self.catalog.get_summary()
            await self._send_json(send, 200, dynamic, headers=[(b"cache-control", b"public, max-age=60")])
            return

        # 2. Catalog
        catalog_path = self.manifest.get("endpoints", {}).get("catalog", "/api/ucp/catalog")
        if method == "GET" and path == catalog_path:
            products = [p.to_dict() for p in self.catalog.get_all_products()]
            json_ld = self.catalog.export_json_ld_list()
            await self._send_json(send, 200, {
                "protocol": "UCP/1.0",
                "count": len(products),
                "products": products,
                "jsonLd": json_ld
            })
            return

        # 3. Negotiate
        negotiate_path = self.manifest.get("endpoints", {}).get("negotiate", "/api/ucp/negotiate")
        if method == "POST" and path == negotiate_path:
            body = await self._read_json_body(receive)
            if not body.get("sku") or not body.get("quantity") or not body.get("agentId"):
                await self._send_json(send, 400, {"error": "Missing required fields: sku, quantity, agentId"})
                return

            product = self.catalog.get_product(body["sku"])
            if not product:
                await self._send_json(send, 404, {"error": f"Product SKU '{body['sku']}' not found in catalog"})
                return

            req_obj = QuoteRequest(
                sku=body["sku"],
                quantity=int(body["quantity"]),
                agent_id=body["agentId"],
                client_nonce=body.get("clientNonce", "0"),
                proposed_price=float(body["proposedPrice"]) if "proposedPrice" in body else None
            )
            quote = self.negotiation_engine.create_quote(req_obj, product)
            await self._send_json(send, 200, quote.to_dict())
            return

        # 4. Checkout
        checkout_path = self.manifest.get("endpoints", {}).get("checkout", "/api/ucp/checkout")
        if method == "POST" and path == checkout_path:
            body = await self._read_json_body(receive)
            raw_quote = body.get("quote")
            payment_proof = body.get("paymentProof")

            if not raw_quote or not payment_proof:
                await self._send_json(send, 400, {"error": "Missing required fields: quote, paymentProof"})
                return

            payment_verify = self.payment_handler.verify_payment(payment_proof)
            if not payment_verify.verified:
                await self._send_json(send, 402, {"error": payment_verify.error or "Payment proof verification failed"})
                return

            fulfill_result = {}
            if self.on_checkout_complete:
                fulfill_result = await self.on_checkout_complete({
                    "quoteId": raw_quote.get("quoteId"),
                    "sku": raw_quote.get("sku"),
                    "quantity": raw_quote.get("quantity"),
                    "amount": raw_quote.get("totalPrice"),
                    "receiptId": payment_verify.receipt_id,
                    "payerId": payment_verify.payer_id
                })

            await self._send_json(send, 200, {
                "status": "fulfilled",
                "quoteId": raw_quote.get("quoteId"),
                "receiptId": payment_verify.receipt_id,
                "amountPaid": raw_quote.get("totalPrice"),
                "currency": raw_quote.get("currency"),
                "fulfillment": fulfill_result
            }, headers=[(b"x-402-receipt", (payment_verify.receipt_id or "").encode("utf-8"))])
            return

        await self.app(scope, receive, send)

    async def _read_json_body(self, receive: Callable) -> Dict[str, Any]:
        body = b""
        more_body = True
        while more_body:
            message = await receive()
            body += message.get("body", b"")
            more_body = message.get("more_body", False)
        return json.loads(body.decode("utf-8")) if body else {}

    async def _send_json(
        self,
        send: Callable,
        status: int,
        data: Dict[str, Any],
        headers: Optional[List[tuple]] = None
    ) -> None:
        raw = json.dumps(data, indent=2).encode("utf-8")
        h = [
            (b"content-type", b"application/json; charset=utf-8"),
            (b"access-control-allow-origin", b"*"),
            (b"content-length", str(len(raw)).encode("utf-8"))
        ]
        if headers:
            h.extend(headers)

        await send({
            "type": "http.response.start",
            "status": status,
            "headers": h
        })
        await send({
            "type": "http.response.body",
            "body": raw
        })
