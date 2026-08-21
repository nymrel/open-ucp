"""
Universal Commerce Protocol (UCP) Python CLI Tool

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

import sys
import os
import json
import argparse
import urllib.request
import secrets
from http.server import HTTPServer, BaseHTTPRequestHandler
from .core import UCPManifestBuilder, ProductCatalog, create_default_manifest
from .types import ProductOffer, PricingTier, NegotiationRules
from .validator import UCPValidator
from .negotiation import NegotiationEngine
from .x402 import X402PaymentHandler


def main():
    parser = argparse.ArgumentParser(description="open-ucp: Universal Commerce Protocol CLI (Python Engine)")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # init
    init_parser = subparsers.add_parser("init", help="Scaffold a ucp.config.json file")
    init_parser.add_argument("--name", default="Nymrel Autonomous Store", help="Merchant Name")
    init_parser.add_argument("--url", default="https://example.com", help="Canonical URL")
    init_parser.add_argument("--email", default="contact@nymrel.com", help="Contact Email")

    # validate
    val_parser = subparsers.add_parser("validate", help="Validate a UCP manifest file or URL")
    val_parser.add_argument("target", default="ucp.config.json", nargs="?", help="File path or URL to manifest")

    # serve
    serve_parser = subparsers.add_parser("serve", help="Start lightweight local UCP server")
    serve_parser.add_argument("--port", "-p", type=int, default=4020, help="Port to listen on")
    serve_parser.add_argument("--config", "-c", default="ucp.config.json", help="Path to config file")

    args = parser.parse_args()

    if args.command == "init":
        handle_init(args)
    elif args.command == "validate":
        handle_validate(args)
    elif args.command == "serve":
        handle_serve(args)
    else:
        parser.print_help()


def handle_init(args):
    target = os.path.abspath("ucp.config.json")
    if os.path.exists(target):
        print(f"[!] ucp.config.json already exists at {target}")
        return

    builder = UCPManifestBuilder()
    builder.set_entity(
        name=args.name,
        url=args.url,
        contactEmail=args.email
    )
    manifest = builder.build()
    config = {
        "manifest": manifest,
        "secretKey": secrets.token_hex(32),
        "products": [
            {
                "sku": "ai-compute-tier1",
                "title": "GPU Inference Capacity (100k Tokens)",
                "description": "High-throughput low-latency inference slot",
                "basePrice": 0.10,
                "currency": "USD",
                "unit": "100k_tokens",
                "stockStatus": "unlimited",
                "pricingTiers": [
                    {"minQuantity": 1, "unitPrice": 0.10, "discountPercent": 0},
                    {"minQuantity": 100, "unitPrice": 0.085, "discountPercent": 15},
                    {"minQuantity": 500, "unitPrice": 0.070, "discountPercent": 30}
                ],
                "negotiationRules": {
                    "allowNegotiation": True,
                    "minAcceptablePrice": 0.05,
                    "maxDiscountPercent": 50
                }
            }
        ]
    }

    with open(target, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    print(f"[OK] Scaffolded starter UCP configuration: {target}")


def handle_validate(args):
    target = args.target
    print(f"[*] Auditing UCP Manifest: {target}")

    if target.startswith("http://") or target.startswith("https://"):
        req = urllib.request.Request(target, headers={"User-Agent": "open-ucp-cli/1.0"})
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    else:
        with open(target, "r", encoding="utf-8") as f:
            data = json.load(f)

    manifest = data.get("manifest", data)
    report = UCPValidator.validate(manifest)

    print("\n======================================================")
    print(f"  UCP VALIDATION REPORT - SCORE: {report.score}/100")
    print("======================================================")
    print(f"  Entity:        {manifest.get('entity', {}).get('name')}")
    print(f"  Parent Entity: {manifest.get('entity', {}).get('parentOrganization', {}).get('legalEntity')}")
    print("------------------------------------------------------")
    if report.valid:
        print("  [OK] 100% Protocol Compliant!")
    else:
        for iss in report.issues:
            print(f"  [{iss.severity.upper()}] {iss.path}: {iss.message}")
    print("======================================================\n")


def handle_serve(args):
    port = args.port
    print(f"[✓] Starting open-ucp dev server on http://localhost:{port}")
    # Simple lightweight HTTP Server
    manifest = create_default_manifest()

    class UCPHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path in ["/.well-known/ucp.json", "/ucp.json"]:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(manifest, indent=2).encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()

    httpd = HTTPServer(("localhost", port), UCPHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
