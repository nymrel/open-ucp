"""Nano receipt verification. Port of dhyabi2's TypeScript settlement rail (MIT)."""

import asyncio
import json
import os
import re
import threading
from decimal import Decimal, localcontext
from typing import Awaitable, Callable, Optional, Protocol
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

XNO_RAW = 10 ** 30
NanoRpcLookup = Callable[[str], Awaitable[Optional[dict]]]


def xno_to_raw(amount: float | str) -> str:
    literal = str(amount)
    if len(literal) > 256:
        raise ValueError("nano amount literal is too long")
    match = re.fullmatch(r"([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?", literal.strip())
    if not match or not (match[2] or match[3]):
        raise ValueError("nano amount is not a decimal number")
    exponent = int(match[4] or 0)
    if abs(exponent) > 128:
        raise ValueError("nano amount exponent is out of range")
    with localcontext() as ctx:
        ctx.prec = 512
        raw = Decimal(literal) * XNO_RAW
        if raw < 0 or raw != raw.to_integral_value():
            raise ValueError("nano amount must be non-negative and no finer than 1 raw")
        return str(int(raw))


def raw_to_xno(raw: int) -> str:
    digits = str(abs(raw)).zfill(31)
    fraction = digits[-30:].rstrip("0")
    return ("-" if raw < 0 else "") + digits[:-30] + ("." + fraction if fraction else "")


def xno_total(unit_price: float, quantity: float) -> int:
    scaled = int(xno_to_raw(unit_price)) * int(xno_to_raw(quantity))
    if scaled % XNO_RAW:
        raise ValueError("nano quote total is finer than 1 raw")
    return scaled // XNO_RAW


async def default_nano_rpc_lookup(block_hash: str) -> Optional[dict]:
    endpoint = os.environ.get("NANO_RPC_URL", "https://rainstorm.city/api")
    if urlsplit(endpoint).scheme not in ("http", "https"):
        raise ValueError("Nano RPC requires an HTTP(S) endpoint")

    def lookup():
        request = Request(endpoint, data=json.dumps({
            "action": "block_info", "json_block": "true", "hash": block_hash
        }).encode(), headers={"content-type": "application/json"}, method="POST")
        # Operator-configured endpoint, scheme restricted above; never a payer URL.
        with urlopen(request, timeout=10) as response:  # nosec B310
            data = json.load(response)
        if not isinstance(data, dict) or data.get("error"):
            return None
        contents = data.get("contents") or {}
        return {
            "hash": block_hash, "exists": True,
            "confirmed": data.get("confirmed") is True or data.get("confirmed") == "true",
            "subtype": data.get("subtype") or contents.get("subtype") or contents.get("type"),
            "blockAccount": data.get("block_account") or contents.get("account"),
            "linkAsAccount": contents.get("link_as_account"),
            "amountRaw": str(data["amount"]) if "amount" in data else None,
            "sourceHash": contents.get("source") or contents.get("link"),
        }
    return await asyncio.to_thread(lookup)


class NanoReceiptLedger(Protocol):
    """A shared implementation must claim once atomically and persist across restarts."""

    def claim(self, payment_id: str, quote_id: str) -> bool | Awaitable[bool]: ...


class InMemoryNanoReceiptLedger:
    """Development default: neither shared between processes nor restart durable."""

    def __init__(self):
        self._spent = {}
        self._lock = threading.Lock()

    def claim(self, payment_id: str, quote_id: str) -> bool:
        key = payment_id.upper()
        with self._lock:
            if key in self._spent:
                return False
            self._spent[key] = quote_id
            return True


async def verify_nano_receipt(block_hash: str, expected_pay_to: str, expected_raw: str,
                              lookup: NanoRpcLookup = default_nano_rpc_lookup) -> dict:
    def reject(reason):
        return {"verified": False, "reason": reason}

    if not isinstance(block_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", block_hash):
        return reject("Nano block hash must be 64 hex chars")
    if not expected_pay_to or not expected_pay_to.startswith("nano_"):
        return reject("Expected pay-to is not a nano_ address")
    info = await lookup(block_hash)
    if not info or not info.get("exists"):
        return reject("Block not found on the public chain")
    if not info.get("confirmed"):
        return reject("Block is not confirmed on the public chain yet")
    subtype = info.get("subtype")
    if subtype in ("receive", "open"):
        payee = info.get("blockAccount")
        source = info.get("sourceHash")
        if not isinstance(source, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", source):
            return reject("Node reported no source send for the receive block")
        payment_id = source.upper()
    elif subtype == "send":
        payee = info.get("linkAsAccount")
        payment_id = block_hash.upper()
    else:
        return reject("Block is not a settlement block")
    if not payee or payee != expected_pay_to:
        return reject("Block does not credit the expected pay-to account")
    amount = info.get("amountRaw")
    if not isinstance(amount, str) or not re.fullmatch(r"[0-9]+", amount):
        return reject("Block amount is not an integer raw value")
    if int(amount) < int(expected_raw):
        return reject("Block amount is below expected raw amount")
    return {"verified": True, "info": info, "paymentId": payment_id}
