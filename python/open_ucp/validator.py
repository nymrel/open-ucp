"""
Universal Commerce Protocol (UCP) Validator Suite (Python)

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
import ipaddress
from urllib.parse import urlsplit

from .types import ValidationIssue, ValidationReport, ProductOffer

MACHINE_ACTION_ENDPOINT_KEYS = ("catalog", "negotiate", "quote", "checkout", "verifyPayment", "webhook")
REQUIRED_ENDPOINT_KEYS = ("catalog", "negotiate", "checkout")


def _is_public_hostname(host: str) -> bool:
    """True only for publicly resolvable hosts (no loopback/private/link-local/single-label)."""
    host = host.strip().lower()
    if host.startswith("[") and host.endswith("]"):
        # IPv6 literal; urlsplit().hostname already strips brackets, this is a safety net.
        try:
            addr = ipaddress.ip_address(host[1:-1])
        except ValueError:
            return False
        if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
            addr = addr.ipv4_mapped
        return not (addr.is_loopback or addr.is_link_local or addr.is_unspecified or addr.is_private)
    if host.endswith("."):
        host = host[:-1]
    if "." not in host:
        return False  # single-label host ("localhost", intranet names)
    if host.endswith((".localhost", ".local", ".internal")):
        return False
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return True  # regular DNS name
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return not (addr.is_loopback or addr.is_link_local or addr.is_unspecified or addr.is_private)


def _https_origin(parts) -> str:
    host = (parts.hostname or "").lower()
    port = parts.port  # may raise ValueError on malformed ports
    if port is None or port == 443:
        return f"https://{host}"
    return f"https://{host}:{port}"


def _check_public_https_url(value: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Entity URL policy. Returns (ok, reason, canonical_origin)."""
    try:
        parts = urlsplit(value)
        origin = _https_origin(parts) if (parts.scheme and parts.netloc) else None
    except ValueError:
        return False, "malformed URL", None
    if not parts.scheme or not parts.netloc:
        return False, "not an absolute URL", None
    if parts.scheme.lower() != "https":
        return False, f'scheme must be https (got "{parts.scheme}")', None
    if parts.username or parts.password:
        return False, "credential-bearing URLs are not allowed", None
    host = parts.hostname or ""
    if not _is_public_hostname(host):
        return False, f'"{host}" is not a publicly resolvable host', None
    return True, None, origin


def _check_machine_action_url(value: str, canonical_origin: Optional[str]) -> Tuple[bool, Optional[str]]:
    """
    Machine-action URL policy: a rooted relative path ("/api/...") resolved
    against the serving origin, or an absolute HTTPS URL on the entity's
    canonical origin.
    """
    if value.startswith("//"):
        return False, "protocol-relative URLs are ambiguous; use a rooted relative path or an absolute HTTPS URL on the entity origin"
    if value.startswith("/"):
        if any(c.isspace() for c in value):
            return False, "relative path must not contain whitespace"
        return True, None
    try:
        parts = urlsplit(value)
        if not parts.scheme or not parts.netloc:
            return False, 'malformed URL; use a rooted relative path ("/api/...") or an absolute HTTPS URL on the entity origin'
        if parts.scheme.lower() != "https":
            return False, "absolute machine-action URLs must use HTTPS"
        if parts.username or parts.password:
            return False, "credential-bearing URLs are not allowed"
        if canonical_origin is not None and _https_origin(parts) != canonical_origin:
            return False, f"cross-origin URLs are not allowed (expected origin {canonical_origin})"
    except ValueError:
        return False, "malformed URL"
    return True, None


class UCPValidator:
    @staticmethod
    def validate_manifest(manifest: Any) -> Dict[str, Any]:
        issues: List[ValidationIssue] = []

        if not isinstance(manifest, dict):
            return {
                "valid": False,
                "issues": [ValidationIssue(path="", message="Manifest must be a non-null dictionary", severity="error")],
                "score": 0
            }

        # Protocol & Version
        if not manifest.get("ucpVersion"):
            issues.append(ValidationIssue(path="ucpVersion", message="Missing ucpVersion", severity="error"))
        if not str(manifest.get("protocol", "")).startswith("UCP/"):
            issues.append(ValidationIssue(path="protocol", message="Invalid protocol identifier (expected UCP/1.0)", severity="error"))

        # Canonical origin, established from a valid entity URL; used to pin
        # machine-action URLs to the entity's own HTTPS origin.
        canonical_origin: Optional[str] = None

        # Entity Trust
        entity = manifest.get("entity")
        if not isinstance(entity, dict):
            issues.append(ValidationIssue(path="entity", message="Missing entity block", severity="error"))
        else:
            if not entity.get("name"):
                issues.append(ValidationIssue(path="entity.name", message="Entity name is required", severity="error"))
            if not entity.get("url"):
                issues.append(ValidationIssue(path="entity.url", message="Entity canonical URL is required", severity="error"))
            elif not isinstance(entity.get("url"), str):
                issues.append(ValidationIssue(path="entity.url", message="Entity URL must be a string", severity="error"))
            else:
                ok, reason, origin = _check_public_https_url(entity["url"])
                if not ok:
                    issues.append(ValidationIssue(
                        path="entity.url",
                        message=f"Entity URL must be a public HTTPS absolute URL ({reason})",
                        severity="error"
                    ))
                else:
                    canonical_origin = origin
            if not entity.get("contactEmail"):
                issues.append(ValidationIssue(path="entity.contactEmail", message="Entity contact email is required", severity="error"))

            parent_org = entity.get("parentOrganization")
            if not isinstance(parent_org, dict):
                issues.append(ValidationIssue(
                    path="entity.parentOrganization",
                    message="Missing parentOrganization entity trust block (dual-audience requirement)",
                    severity="warning"
                ))
            else:
                if not parent_org.get("name"):
                    issues.append(ValidationIssue(path="entity.parentOrganization.name", message="Parent organization name required", severity="warning"))
                if not parent_org.get("legalEntity"):
                    issues.append(ValidationIssue(path="entity.parentOrganization.legalEntity", message="Parent legal entity required", severity="warning"))

        # Endpoints
        endpoints = manifest.get("endpoints")
        if not isinstance(endpoints, dict):
            issues.append(ValidationIssue(path="endpoints", message="Missing endpoints block", severity="error"))
        else:
            for ep in REQUIRED_ENDPOINT_KEYS:
                if not endpoints.get(ep):
                    issues.append(ValidationIssue(path=f"endpoints.{ep}", message=f"Endpoint {ep} is required", severity="error"))
            for ep in MACHINE_ACTION_ENDPOINT_KEYS:
                value = endpoints.get(ep)
                if value is None or value == "":
                    continue
                if not isinstance(value, str):
                    issues.append(ValidationIssue(
                        path=f"endpoints.{ep}",
                        message="Endpoint must be a rooted relative path or an HTTPS URL on the entity canonical origin",
                        severity="error"
                    ))
                    continue
                ok, reason = _check_machine_action_url(value, canonical_origin)
                if not ok:
                    issues.append(ValidationIssue(
                        path=f"endpoints.{ep}",
                        message=f"Endpoint must be a rooted relative path or an HTTPS URL on the entity canonical origin ({reason})",
                        severity="error"
                    ))

        # llms.txt Discoverability
        llms_txt_url = manifest.get("llmsTxtUrl")
        if isinstance(llms_txt_url, str) and llms_txt_url != "":
            ok, reason = _check_machine_action_url(llms_txt_url, canonical_origin)
            if not ok:
                issues.append(ValidationIssue(
                    path="llmsTxtUrl",
                    message=f"llmsTxtUrl must be a rooted relative path or an HTTPS URL on the entity canonical origin ({reason})",
                    severity="error"
                ))

        # Payment Rails
        rails = manifest.get("paymentRails")
        if not isinstance(rails, dict) or not any(isinstance(r, dict) and r.get("enabled") for r in rails.values()):
            issues.append(ValidationIssue(path="paymentRails", message="At least one payment rail must be enabled", severity="error"))

        # Security
        sec = manifest.get("security")
        if not isinstance(sec, dict):
            issues.append(ValidationIssue(path="security", message="Missing security policy", severity="error"))
        else:
            if not sec.get("signingAlgorithm"):
                issues.append(ValidationIssue(path="security.signingAlgorithm", message="Signing algorithm required", severity="error"))
            if not sec.get("quoteTtlSeconds") or int(sec.get("quoteTtlSeconds", 0)) <= 0:
                issues.append(ValidationIssue(path="security.quoteTtlSeconds", message="quoteTtlSeconds must be > 0", severity="error"))

        errors = [i for i in issues if i.severity == "error"]
        warnings = [i for i in issues if i.severity == "warning"]

        score = max(0, 100 - len(errors) * 15 - len(warnings) * 5)
        return {
            "valid": len(errors) == 0,
            "issues": issues,
            "score": score
        }

    @staticmethod
    def validate_jsonld_parity(product: ProductOffer, json_ld: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        issues: List[ValidationIssue] = []
        target = json_ld or product.json_ld

        if not target:
            issues.append(ValidationIssue(path=f"products[{product.sku}].jsonLd", message="No JSON-LD metadata", severity="warning"))
            return {"valid": True, "issues": issues, "parityScore": 50}

        if target.get("@type") != "Product":
            issues.append(ValidationIssue(path=f"products[{product.sku}].jsonLd.@type", message="Expected @type Product", severity="error"))

        if target.get("name") != product.title:
            issues.append(ValidationIssue(path=f"products[{product.sku}].jsonLd.name", message="Name mismatch with title", severity="warning"))

        offers = target.get("offers")
        if not isinstance(offers, dict):
            issues.append(ValidationIssue(path=f"products[{product.sku}].jsonLd.offers", message="Missing offers object", severity="error"))
        else:
            if float(offers.get("price", -1)) != product.base_price:
                issues.append(ValidationIssue(path=f"products[{product.sku}].jsonLd.offers.price", message="Price mismatch with basePrice", severity="error"))
            if str(offers.get("priceCurrency", "")).upper() != product.currency.upper():
                issues.append(ValidationIssue(path=f"products[{product.sku}].jsonLd.offers.priceCurrency", message="Currency mismatch", severity="error"))

        errors = [i for i in issues if i.severity == "error"]
        warnings = [i for i in issues if i.severity == "warning"]
        score = max(0, 100 - len(errors) * 30 - len(warnings) * 10)
        return {
            "valid": len(errors) == 0,
            "issues": issues,
            "parityScore": score
        }

    @classmethod
    def validate(cls, manifest: Any, products: Optional[List[ProductOffer]] = None) -> ValidationReport:
        manifest_res = cls.validate_manifest(manifest)
        issues: List[ValidationIssue] = list(manifest_res["issues"])

        jsonld_score = 100
        if products:
            total_parity = 0
            for p in products:
                p_res = cls.validate_jsonld_parity(p)
                issues.extend(p_res["issues"])
                total_parity += p_res["parityScore"]
            jsonld_score = round(total_parity / len(products))

        manifest_obj = manifest if isinstance(manifest, dict) else {}
        entity = manifest_obj.get("entity", {})
        parent_org = entity.get("parentOrganization", {})
        parent_org_verified = bool(parent_org.get("name") and parent_org.get("legalEntity"))

        endpoints = manifest_obj.get("endpoints", {})
        endpoints_functional = bool(endpoints.get("catalog") and endpoints.get("negotiate") and endpoints.get("checkout"))

        rails = manifest_obj.get("paymentRails", {})
        payment_rails_configured = bool(isinstance(rails, dict) and any(isinstance(r, dict) and r.get("enabled") for r in rails.values()))
        ap2_compliance = bool(isinstance(rails.get("ap2"), dict) and rails["ap2"].get("enabled"))

        errors = [i for i in issues if i.severity == "error"]
        warnings = [i for i in issues if i.severity == "warning"]

        overall = max(0, min(100, round(manifest_res["score"] * 0.6 + jsonld_score * 0.4 - len(warnings) * 2)))

        return ValidationReport(
            valid=len(errors) == 0,
            score=overall,
            issues=issues,
            details={
                "manifestSchema": manifest_res["valid"],
                "entityTrust": bool(entity.get("verified")),
                "parentOrgVerified": parent_org_verified,
                "endpointsFunctional": endpoints_functional,
                "paymentRailsConfigured": payment_rails_configured,
                "jsonLdParityScore": jsonld_score,
                "ap2Compliance": ap2_compliance
            }
        )
