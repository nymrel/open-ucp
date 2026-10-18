"""
Universal Commerce Protocol (UCP) - X402 Payment Required Engine (Python)

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

import inspect
from .nano import (NanoRpcLookup, NanoReceiptLedger, NanoPaymentAuthorizer,
                   default_nano_rpc_lookup, verify_nano_receipt, xno_to_raw, raw_to_xno)
import hmac
import hashlib
import base64
import json
import secrets
from typing import Optional, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta
from .types import X402Challenge, PaymentVerificationResult


class X402PaymentHandler:
    def __init__(
        self,
        secret_key: str,
        pay_to: str = "0x0000000000000000000000000000000000000000",
        default_network: str = "polygon",
        default_currency: str = "USD",
        challenge_ttl_seconds: int = 300,
        nano_rpc_lookup: Optional[NanoRpcLookup] = None,
        nano_receipt_ledger: Optional[NanoReceiptLedger] = None,
        nano_payment_authorizer: Optional[NanoPaymentAuthorizer] = None
    ):
        if not secret_key:
            raise ValueError("X402PaymentHandler requires secret_key for cryptographic verification.")
        self.nano_rpc_lookup = nano_rpc_lookup or default_nano_rpc_lookup
        self.nano_payment_authorizer = nano_payment_authorizer
        self.nano_receipt_ledger = nano_receipt_ledger
        self.secret_key = secret_key
        self.pay_to = pay_to
        self.default_network = default_network
        self.default_currency = default_currency
        self.challenge_ttl_seconds = challenge_ttl_seconds
        if self.default_network == "nano":
            self._require_nano_configuration()

    def _require_nano_configuration(self):
        if not callable(self.nano_payment_authorizer) or not callable(getattr(self.nano_receipt_ledger, "claim", None)):
            raise ValueError("Nano requires a trusted payment authorizer and an explicit receipt ledger before offering payment instructions")

    def create_challenge(
        self,
        amount: float,
        pay_to: Optional[str] = None,
        currency: Optional[str] = None,
        network: Optional[str] = None,
        quote_id: Optional[str] = None,
        ttl_seconds: Optional[int] = None,
        payment_url: Optional[str] = None,
        description: Optional[str] = None
    ) -> Tuple[X402Challenge, Dict[str, str]]:
        target_pay_to = pay_to or self.pay_to
        target_curr = (currency or self.default_currency).upper()
        target_net = network or self.default_network
        if target_net == "nano":
            self._require_nano_configuration()
        ttl = ttl_seconds or self.challenge_ttl_seconds
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=ttl)).isoformat()
        amount_str = raw_to_xno(int(xno_to_raw(amount))) if target_curr == "XNO" else f"{amount:.2f}"

        challenge_header = f'X-402 realm="UCP", pay_to="{target_pay_to}", amount="{amount_str}", currency="{target_curr}", network="{target_net}"'
        if quote_id:
            challenge_header += f', quote_id="{quote_id}"'
        challenge_header += f', expires_at="{expires_at}"'

        challenge = X402Challenge(
            version="1.0",
            pay_to=target_pay_to,
            amount=amount,
            currency=target_curr,
            network=target_net,
            quote_id=quote_id,
            expires_at=expires_at,
            payment_url=payment_url,
            description=description or "Programmatic payment required for agent resource",
            challenge_header=challenge_header
        )

        headers = {
            "X-402-Version": "1.0",
            "X-402-Pay-To": target_pay_to,
            "X-402-Amount": amount_str,
            "X-402-Currency": target_curr,
            "X-402-Network": target_net,
            "X-402-Expires-At": expires_at,
            "WWW-Authenticate": challenge_header
        }
        if quote_id:
            headers["X-402-Quote-Id"] = quote_id
        if payment_url:
            headers["X-402-Payment-Url"] = payment_url

        return challenge, headers

    def extract_payment_header(self, headers: Dict[str, Any]) -> Optional[str]:
        norm = {k.lower(): v for k, v in headers.items()}
        if "x-402-authorization" in norm:
            return norm["x-402-authorization"]

        auth = norm.get("authorization")
        if auth:
            if auth.startswith("X-402 ") or auth.startswith("x-402 "):
                return auth[6:].strip()
            if auth.startswith("Bearer x402_") or auth.startswith("bearer x402_"):
                return auth[7:].strip()
            if auth.startswith("L402 ") or auth.startswith("l402 "):
                return auth[5:].strip()

        return None

    def create_payment_proof_token(
        self,
        quote_id: str,
        amount: float,
        currency: str,
        payer_id: str,
        expires_at: Optional[str] = None
    ) -> str:
        expires = expires_at or (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        data = f"{quote_id}:{amount:.2f}:{currency}:{payer_id}:{expires}"
        sig = hmac.new(self.secret_key.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).hexdigest()
        token_dict = {
            "quoteId": quote_id,
            "amount": amount,
            "currency": currency,
            "payerId": payer_id,
            "expiresAt": expires,
            "sig": sig
        }
        raw_json = json.dumps(token_dict).encode("utf-8")
        b64 = base64.urlsafe_b64encode(raw_json).decode("utf-8").rstrip("=")
        return f"x402_{b64}"

    def verify_payment(self, token_or_dict: Any) -> PaymentVerificationResult:
        try:
            token_str = token_or_dict if isinstance(token_or_dict, str) else token_or_dict.get("token", "")
            if token_str.startswith("x402_"):
                token_str = token_str[5:]

            # Add padding
            rem = len(token_str) % 4
            if rem > 0:
                token_str += "=" * (4 - rem)

            decoded_bytes = base64.urlsafe_b64decode(token_str)
            decoded = json.loads(decoded_bytes.decode("utf-8"))

            for req_field in ["quoteId", "amount", "currency", "payerId", "sig", "expiresAt"]:
                if req_field not in decoded:
                    return PaymentVerificationResult(verified=False, error="Malformed payment proof token structure")

            # Check expiration
            expires_dt = datetime.fromisoformat(decoded["expiresAt"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > expires_dt:
                return PaymentVerificationResult(verified=False, error="Payment proof token has expired")

            data = f"{decoded['quoteId']}:{float(decoded['amount']):.2f}:{decoded['currency']}:{decoded['payerId']}:{decoded['expiresAt']}"
            expected_sig = hmac.new(self.secret_key.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).hexdigest()

            if not hmac.compare_digest(expected_sig, decoded["sig"]):
                return PaymentVerificationResult(verified=False, error="Invalid cryptographic signature on payment proof")

            receipt_id = f"ucp_rcpt_{secrets.token_hex(12)}"
            return PaymentVerificationResult(
                verified=True,
                receipt_id=receipt_id,
                amount=float(decoded["amount"]),
                currency=decoded["currency"],
                payer_id=decoded["payerId"]
            )
        except Exception as e:
            return PaymentVerificationResult(verified=False, error=f"Payment verification failed: {str(e)}")

    async def verify_nano_settlement(self, *, tx_hash: str, amount_xno: float | str,
                                     quote_id: str, currency: str = "XNO",
                                     pay_to: Optional[str] = None) -> PaymentVerificationResult:
        destination = pay_to or self.pay_to
        if not destination.startswith("nano_"):
            return PaymentVerificationResult(False, error="A nano network requires a nano_ pay-to address")
        if currency.upper() != "XNO":
            return PaymentVerificationResult(False, error="A nano settlement must be quoted in XNO")
        if not quote_id:
            return PaymentVerificationResult(False, error="A nano settlement must name the quote it settles")
        if not callable(self.nano_payment_authorizer) or self.nano_receipt_ledger is None:
            return PaymentVerificationResult(False, error="Nano settlement requires trusted order-bound payment authorization and an explicit receipt ledger")
        try:
            expected = xno_to_raw(amount_xno)
            if int(expected) <= 0:
                return PaymentVerificationResult(False, error="A nano settlement amount must be above zero")
            result = await verify_nano_receipt(tx_hash, destination, expected, self.nano_rpc_lookup)
            if not result["verified"]:
                return PaymentVerificationResult(False, error=result.get("reason"))
            authorized = self.nano_payment_authorizer({
                "paymentId": result["paymentId"], "quoteId": quote_id,
                "payTo": destination, "amountRaw": expected, "block": result["info"]
            })
            if inspect.isawaitable(authorized):
                authorized = await authorized
            if authorized is not True:
                return PaymentVerificationResult(False, error="Nano payment is not authorized for this order")
            claimed = self.nano_receipt_ledger.claim(result["paymentId"], quote_id)
            if inspect.isawaitable(claimed):
                claimed = await claimed
            if claimed is not True:
                return PaymentVerificationResult(False, error="This Nano payment has already settled an order")
            return PaymentVerificationResult(
                True, receipt_id="ucp_nano_" + tx_hash[:24], amount=amount_xno,
                currency="XNO", payer_id=tx_hash
            )
        except Exception as error:
            return PaymentVerificationResult(False, error=f"Nano settlement lookup, authorization or ledger failed: {error}")
