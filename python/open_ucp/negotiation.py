"""
Universal Commerce Protocol (UCP) Machine Negotiation Engine (Python)

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

import hmac
import hashlib
import secrets
import math
import json
from decimal import Decimal, ROUND_HALF_UP, localcontext
from .nano import xno_to_raw, raw_to_xno, xno_total
from typing import Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from .types import (
    QuoteRequest,
    SignedQuote,
    ProductOffer
)


def _js_number_text(value: float) -> str:
    numeric = Decimal(str(value))
    if numeric == 0:
        return "0"
    if Decimal("0.000001") <= abs(numeric) < Decimal("1e21"):
        text = format(numeric, "f")
        return text.rstrip("0").rstrip(".") if "." in text else text
    mantissa, exponent = format(numeric.normalize(), "e").split("e")
    return mantissa + "e" + ("+" if int(exponent) >= 0 else "-") + str(abs(int(exponent)))


class NegotiationEngine:
    def __init__(
        self,
        secret_key: str,
        default_ttl_seconds: int = 300,
        default_protocol: str = "x402",
        pay_to: Optional[str] = None,
        network: Optional[str] = None
    ):
        if not secret_key:
            raise ValueError("NegotiationEngine requires secret_key for cryptographic signing.")
        self.secret_key = secret_key
        self.default_ttl_seconds = default_ttl_seconds
        self.default_protocol = default_protocol
        self.pay_to = pay_to
        self.network = network

    def create_quote(self, request: QuoteRequest, product: ProductOffer) -> SignedQuote:
        if product.stock_status == "out_of_stock":
            return self._generate_rejected_quote(request, product, "Item is currently out of stock")

        if isinstance(request.quantity, bool) or request.quantity <= 0 or request.quantity > 2**53 - 1 or not math.isfinite(request.quantity):
            return self._generate_rejected_quote(request, product, "Invalid quantity requested")

        is_xno = product.currency.upper() == "XNO"
        base_price = product.base_price
        effective_unit_price = base_price
        applied_discount = 0.0

        # 1. Tiered Pricing Evaluation
        if product.pricing_tiers:
            sorted_tiers = sorted(product.pricing_tiers, key=lambda t: t.min_quantity, reverse=True)
            for tier in sorted_tiers:
                if request.quantity >= tier.min_quantity:
                    if tier.max_quantity is None or request.quantity <= tier.max_quantity:
                        effective_unit_price = tier.unit_price
                        applied_discount = tier.discount_percent
                        break

        # 2. Dynamic Negotiation Evaluation
        rules = product.negotiation_rules
        status = "accepted"
        reason = "Quote generated according to standard pricing schedule"

        if rules and rules.allow_negotiation and request.proposed_price is not None:
            proposed = request.proposed_price
            min_price = rules.min_acceptable_price
            max_discount = rules.max_discount_percent
            auto_accept = (
                rules.auto_accept_threshold
                if rules.auto_accept_threshold is not None
                else base_price * (1 - (max_discount / 100.0) * 0.5)
            )

            if proposed >= effective_unit_price:
                effective_unit_price = effective_unit_price
                status = "accepted"
                reason = "Proposed price meets or exceeds standard tier price"
            elif proposed >= auto_accept:
                effective_unit_price = proposed
                applied_discount = round(((base_price - proposed) / base_price) * 100.0, 2)
                status = "accepted"
                reason = "Agent proposed price auto-accepted"
            elif proposed >= min_price:
                volume_factor = min(1.0, math.log10(request.quantity + 1) * rules.volume_sensitivity)
                curve_price = min_price + (effective_unit_price - min_price) * (1.0 - volume_factor * 0.5)
                counter_price = curve_price if is_xno else round(curve_price, 2)

                if proposed >= counter_price:
                    effective_unit_price = proposed
                    applied_discount = round(((base_price - proposed) / base_price) * 100.0, 2)
                    status = "accepted"
                    reason = "Agent proposal accepted based on volume dynamic margin curve"
                else:
                    effective_unit_price = counter_price
                    applied_discount = round(((base_price - counter_price) / base_price) * 100.0, 2)
                    status = "counter_offer"
                    reason = f"Proposed price below volume curve. Counter-offer extended at {counter_price} {product.currency}"
            else:
                effective_unit_price = min_price
                applied_discount = round(((base_price - min_price) / base_price) * 100.0, 2)
                status = "counter_offer"
                reason = f"Proposed price below minimum floor ({min_price} {product.currency}). Floor counter-offer extended."
        elif rules and not rules.allow_negotiation and request.proposed_price is not None and request.proposed_price < effective_unit_price:
            status = "counter_offer"
            reason = "Fixed pricing policy in effect. Negotiation not enabled for this SKU."

        if is_xno:
            total_raw = xno_total(effective_unit_price, request.quantity)
            total_price = raw_to_xno(total_raw)
            savings = raw_to_xno(xno_total(base_price, request.quantity) - total_raw)
        else:
            total_price = round(effective_unit_price * request.quantity, 2)
            base_total = round(base_price * request.quantity, 2)
            savings = round(base_total - total_price, 2)

        quote_id = f"ucp_quote_{secrets.token_hex(12)}"
        now = datetime.now(timezone.utc)
        issued_at = now.isoformat()
        expires_at = (now + timedelta(seconds=self.default_ttl_seconds)).isoformat()

        settlement = {
            "protocol": self.default_protocol, "payTo": self.pay_to, "network": self.network
        }
        sig = self._sign_payload(
            quote_id=quote_id,
            sku=product.sku,
            quantity=request.quantity,
            total_price=total_price,
            currency=product.currency,
            expires_at=expires_at,
            agent_id=request.agent_id,
            client_nonce=request.client_nonce,
            settlement_instructions=settlement
        )

        return SignedQuote(
            quote_id=quote_id,
            sku=product.sku,
            quantity=request.quantity,
            unit_price=effective_unit_price,
            total_price=total_price,
            currency=product.currency,
            discount_percent=applied_discount,
            savings=savings,
            agent_id=request.agent_id,
            client_nonce=request.client_nonce,
            status=status,
            reason=reason,
            issued_at=issued_at,
            expires_at=expires_at,
            signature=sig,
            settlement_instructions=settlement
        )

    def verify_quote(self, quote: SignedQuote) -> Dict[str, Any]:
        try:
            expires_dt = datetime.fromisoformat(quote.expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > expires_dt:
                return {"valid": False, "isExpired": True, "reason": "Quote has expired"}

            expected_sig = self._sign_payload(
                quote_id=quote.quote_id,
                sku=quote.sku,
                quantity=quote.quantity,
                total_price=quote.total_price,
                currency=quote.currency,
                expires_at=quote.expires_at,
                agent_id=quote.agent_id,
                client_nonce=quote.client_nonce,
                settlement_instructions=quote.settlement_instructions
            )

            if not hmac.compare_digest(expected_sig, quote.signature):
                return {"valid": False, "isExpired": False, "reason": "Cryptographic signature mismatch on quote"}

            return {"valid": True, "isExpired": False, "quote": quote}
        except Exception as e:
            return {"valid": False, "isExpired": False, "reason": f"Quote verification exception: {str(e)}"}

    def _sign_payload(
        self,
        quote_id: str,
        sku: str,
        quantity: int | float,
        total_price: float | str,
        currency: str,
        expires_at: str,
        agent_id: str,
        client_nonce: str,
        settlement_instructions: dict
    ) -> str:
        if isinstance(quantity, bool) or quantity <= 0 or quantity > 2**53 - 1 or not math.isfinite(quantity):
            raise ValueError("Quote quantity must be positive and within the binary64 safe integer range")
        settlement = settlement_instructions or {"protocol": self.default_protocol}
        instructions = json.dumps([
            settlement.get("protocol"), settlement.get("payTo") or "",
            settlement.get("network") or "", settlement.get("token") or "",
            settlement.get("checkoutUrl") or ""
        ], ensure_ascii=False, separators=(",", ":"))
        if currency.upper() == "XNO":
            amount = xno_to_raw(total_price)
        elif abs(float(total_price)) >= 1e21:
            amount = _js_number_text(float(total_price))
        else:
            # Match JS toFixed(2): binary64 input, ties away from zero.
            with localcontext() as ctx:
                ctx.prec = 400
                numeric_total = float(total_price)
                if numeric_total == 0:
                    numeric_total = 0.0
                amount = format(Decimal.from_float(numeric_total).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP), ".2f")
        quantity_text = _js_number_text(quantity)
        serialized = f"{quote_id}:{sku}:{quantity_text}:{amount}:{currency.upper()}:{expires_at}:{agent_id}:{client_nonce}:{instructions}"
        return hmac.new(
            self.secret_key.encode("utf-8"),
            serialized.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()

    def _generate_rejected_quote(self, request: QuoteRequest, product: ProductOffer, reason: str) -> SignedQuote:
        quote_id = f"ucp_quote_rej_{secrets.token_hex(8)}"
        now = datetime.now(timezone.utc).isoformat()
        return SignedQuote(
            quote_id=quote_id,
            sku=product.sku,
            quantity=request.quantity,
            unit_price=product.base_price,
            total_price=0.0,
            currency=product.currency,
            discount_percent=0.0,
            savings=0.0,
            agent_id=request.agent_id,
            client_nonce=request.client_nonce,
            status="rejected",
            reason=reason,
            issued_at=now,
            expires_at=now,
            signature="0" * 64,
            settlement_instructions={"protocol": self.default_protocol}
        )
