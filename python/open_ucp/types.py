"""
Universal Commerce Protocol (UCP) & Agentic Purchasing (AP2) Python Types
Standard Specification: UCP 1.0.0

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime, timezone


@dataclass
class ParentOrganization:
    name: str = "Nymrel"
    legal_entity: str = "JalenBuilds LLC"
    url: Optional[str] = "https://jalenbuilds.com"
    duns: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "legalEntity": self.legal_entity,
            "url": self.url,
            "duns": self.duns
        }


@dataclass
class EntityTrust:
    name: str = "Nymrel Platform"
    legal_name: str = "Nymrel"
    parent_organization: ParentOrganization = field(default_factory=ParentOrganization)
    url: str = "https://nymrel.com"
    contact_email: str = "contact@nymrel.com"
    description: str = "Autonomous commerce, programmatic negotiation & agent checkout infrastructure"
    verified: bool = True
    machine_trust_score: float = 0.99

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "legalName": self.legal_name,
            "parentOrganization": self.parent_organization.to_dict(),
            "url": self.url,
            "contactEmail": self.contact_email,
            "description": self.description,
            "verified": self.verified,
            "machineTrustScore": self.machine_trust_score
        }


@dataclass
class UCPCapabilities:
    instant_checkout: bool = True
    machine_negotiation: bool = True
    x402_payments: bool = True
    ap2_protocol: bool = True
    dynamic_pricing: bool = True
    streaming_settlement: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "instantCheckout": self.instant_checkout,
            "machineNegotiation": self.machine_negotiation,
            "x402Payments": self.x402_payments,
            "ap2Protocol": self.ap2_protocol,
            "dynamicPricing": self.dynamic_pricing,
            "streamingSettlement": self.streaming_settlement
        }


@dataclass
class UCPEndpoints:
    catalog: str = "/api/ucp/catalog"
    negotiate: str = "/api/ucp/negotiate"
    quote: Optional[str] = "/api/ucp/quote"
    checkout: str = "/api/ucp/checkout"
    verify_payment: Optional[str] = "/api/ucp/verify-payment"
    webhook: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "catalog": self.catalog,
            "negotiate": self.negotiate,
            "quote": self.quote,
            "checkout": self.checkout,
            "verifyPayment": self.verify_payment,
            "webhook": self.webhook
        }


@dataclass
class PricingTier:
    min_quantity: int
    unit_price: float
    discount_percent: float
    max_quantity: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "minQuantity": self.min_quantity,
            "unitPrice": self.unit_price,
            "discountPercent": self.discount_percent
        }
        if self.max_quantity is not None:
            d["maxQuantity"] = self.max_quantity
        return d


@dataclass
class NegotiationRules:
    allow_negotiation: bool = True
    min_acceptable_price: float = 0.0
    max_discount_percent: float = 30.0
    volume_sensitivity: float = 0.5
    auto_accept_threshold: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "allowNegotiation": self.allow_negotiation,
            "minAcceptablePrice": self.min_acceptable_price,
            "maxDiscountPercent": self.max_discount_percent,
            "volumeSensitivity": self.volume_sensitivity
        }
        if self.auto_accept_threshold is not None:
            d["autoAcceptThreshold"] = self.auto_accept_threshold
        return d


@dataclass
class ProductOffer:
    sku: str
    title: str
    description: str
    base_price: float
    currency: str = "USD"
    unit: str = "unit"
    stock_status: Literal["in_stock", "preorder", "unlimited", "out_of_stock"] = "in_stock"
    category: Optional[str] = None
    pricing_tiers: List[PricingTier] = field(default_factory=list)
    negotiation_rules: Optional[NegotiationRules] = None
    delivery_methods: List[str] = field(default_factory=lambda: ["instant_api", "digital_download"])
    metadata: Dict[str, Any] = field(default_factory=dict)
    json_ld: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sku": self.sku,
            "title": self.title,
            "description": self.description,
            "basePrice": self.base_price,
            "currency": self.currency,
            "unit": self.unit,
            "stockStatus": self.stock_status,
            "category": self.category,
            "pricingTiers": [t.to_dict() for t in self.pricing_tiers],
            "negotiationRules": self.negotiation_rules.to_dict() if self.negotiation_rules else None,
            "deliveryMethods": self.delivery_methods,
            "metadata": self.metadata,
            "jsonLd": self.json_ld
        }


@dataclass
class QuoteRequest:
    sku: str
    quantity: int
    agent_id: str
    client_nonce: str
    target_currency: Optional[str] = None
    proposed_price: Optional[float] = None
    delivery_preference: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SignedQuote:
    quote_id: str
    sku: str
    quantity: int
    unit_price: float
    total_price: float
    currency: str
    discount_percent: float
    savings: float
    agent_id: str
    client_nonce: str
    status: Literal["accepted", "counter_offer", "rejected"]
    reason: str
    issued_at: str
    expires_at: str
    signature: str
    settlement_instructions: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "quoteId": self.quote_id,
            "sku": self.sku,
            "quantity": self.quantity,
            "unitPrice": self.unit_price,
            "totalPrice": self.total_price,
            "currency": self.currency,
            "discountPercent": self.discount_percent,
            "savings": self.savings,
            "agentId": self.agent_id,
            "clientNonce": self.client_nonce,
            "status": self.status,
            "reason": self.reason,
            "issuedAt": self.issued_at,
            "expiresAt": self.expires_at,
            "signature": self.signature,
            "settlementInstructions": self.settlement_instructions
        }


@dataclass
class X402Challenge:
    version: str
    pay_to: str
    amount: float
    currency: str
    network: str
    expires_at: str
    quote_id: Optional[str] = None
    payment_url: Optional[str] = None
    description: Optional[str] = None
    challenge_header: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "payTo": self.pay_to,
            "amount": self.amount,
            "currency": self.currency,
            "network": self.network,
            "quoteId": self.quote_id,
            "expiresAt": self.expires_at,
            "paymentUrl": self.payment_url,
            "description": self.description,
            "challengeHeader": self.challenge_header
        }


@dataclass
class PaymentVerificationResult:
    verified: bool
    receipt_id: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    payer_id: Optional[str] = None
    error: Optional[str] = None


@dataclass
class ValidationIssue:
    path: str
    message: str
    severity: Literal["error", "warning"] = "error"


@dataclass
class ValidationReport:
    valid: bool
    score: int
    issues: List[ValidationIssue]
    details: Dict[str, Any]
