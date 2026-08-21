"""
Universal Commerce Protocol (UCP) Validator Suite (Python)

Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from .types import ValidationIssue, ValidationReport, ProductOffer


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

        # Entity Trust
        entity = manifest.get("entity")
        if not isinstance(entity, dict):
            issues.append(ValidationIssue(path="entity", message="Missing entity block", severity="error"))
        else:
            if not entity.get("name"):
                issues.append(ValidationIssue(path="entity.name", message="Entity name is required", severity="error"))
            if not entity.get("url"):
                issues.append(ValidationIssue(path="entity.url", message="Entity canonical URL is required", severity="error"))
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
            for ep in ["catalog", "negotiate", "checkout"]:
                if not endpoints.get(ep):
                    issues.append(ValidationIssue(path=f"endpoints.{ep}", message=f"Endpoint {ep} is required", severity="error"))

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
