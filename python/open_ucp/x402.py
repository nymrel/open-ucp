"""
Universal Commerce Protocol (UCP) - X402 Payment Required Engine (Python)

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

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
        challenge_ttl_seconds: int = 300
    ):
        if not secret_key:
            raise ValueError("X402PaymentHandler requires secret_key for cryptographic verification.")
        self.secret_key = secret_key
        self.pay_to = pay_to
        self.default_network = default_network
        self.default_currency = default_currency
        self.challenge_ttl_seconds = challenge_ttl_seconds

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
        ttl = ttl_seconds or self.challenge_ttl_seconds
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=ttl)).isoformat()
        amount_str = f"{amount:.2f}"

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
