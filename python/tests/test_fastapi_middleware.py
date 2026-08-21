"""
Unit tests for open_ucp FastAPI / ASGI Middleware (Python)
"""

import unittest
import asyncio
import json
from open_ucp.fastapi_middleware import UCPFastAPIMiddleware
from open_ucp.core import create_default_manifest, ProductCatalog
from open_ucp.types import ProductOffer


class TestUCPFastAPIMiddleware(unittest.IsolatedAsyncioTestCase):
    async def test_asgi_manifest_interception(self):
        manifest = create_default_manifest()
        catalog = ProductCatalog()
        catalog.add_product(ProductOffer(
            sku="test-py-sku",
            title="Python Test Service",
            description="Automated ASGI test",
            base_price=10.00
        ))

        async def dummy_app(scope, receive, send):
            await send({"type": "http.response.start", "status": 404, "headers": []})
            await send({"type": "http.response.body", "body": b"Not Found"})

        middleware = UCPFastAPIMiddleware(
            app=dummy_app,
            manifest=manifest,
            catalog=catalog,
            secret_key="test_asgi_secret"
        )

        # Simulate GET /.well-known/ucp.json
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/.well-known/ucp.json"
        }

        sent_messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(msg):
            sent_messages.append(msg)

        await middleware(scope, receive, send)

        self.assertEqual(len(sent_messages), 2)
        self.assertEqual(sent_messages[0]["status"], 200)

        body_json = json.loads(sent_messages[1]["body"].decode("utf-8"))
        self.assertEqual(body_json["ucpVersion"], "1.0.0")
        self.assertEqual(body_json["catalogSummary"]["productCount"], 1)

    async def test_asgi_negotiate_interception(self):
        manifest = create_default_manifest()
        catalog = ProductCatalog()
        catalog.add_product(ProductOffer(
            sku="test-py-sku",
            title="Python Test Service",
            description="Automated ASGI test",
            base_price=10.00
        ))

        async def dummy_app(scope, receive, send):
            pass

        middleware = UCPFastAPIMiddleware(
            app=dummy_app,
            manifest=manifest,
            catalog=catalog,
            secret_key="test_asgi_secret"
        )

        req_payload = {
            "sku": "test-py-sku",
            "quantity": 3,
            "agentId": "agent_asgi"
        }

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/ucp/negotiate"
        }

        sent_messages = []

        async def receive():
            return {
                "type": "http.request",
                "body": json.dumps(req_payload).encode("utf-8"),
                "more_body": False
            }

        async def send(msg):
            sent_messages.append(msg)

        await middleware(scope, receive, send)

        self.assertEqual(sent_messages[0]["status"], 200)
        body_json = json.loads(sent_messages[1]["body"].decode("utf-8"))
        self.assertEqual(body_json["sku"], "test-py-sku")
        self.assertEqual(body_json["totalPrice"], 30.00)
        self.assertEqual(body_json["status"], "accepted")


if __name__ == "__main__":
    unittest.main()
