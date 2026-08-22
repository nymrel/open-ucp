"""
Unit tests for open_ucp Validator Suite (Python)
"""

import unittest
import copy
from open_ucp.validator import UCPValidator
from open_ucp.core import create_default_manifest


class TestUCPValidator(unittest.TestCase):
    def test_valid_default_manifest(self):
        manifest = create_default_manifest()
        report = UCPValidator.validate(manifest)

        self.assertTrue(report.valid)
        self.assertGreaterEqual(report.score, 90)
        self.assertTrue(report.details["manifestSchema"])
        self.assertTrue(report.details["parentOrgVerified"])
        self.assertTrue(report.details["endpointsFunctional"])

    def test_invalid_manifest(self):
        broken = {"ucpVersion": "1.0.0"}
        report = UCPValidator.validate(broken)

        self.assertFalse(report.valid)
        self.assertGreater(len(report.issues), 0)


class TestCanonicalOriginVerification(unittest.TestCase):
    def setUp(self):
        self.base = create_default_manifest()

    def validate_mutation(self, mutate):
        manifest = copy.deepcopy(self.base)
        mutate(manifest)
        return UCPValidator.validate_manifest(manifest)

    def issue_paths(self, result):
        return [issue.path for issue in result["issues"]]

    def test_default_manifest_passes_origin_rules(self):
        result = UCPValidator.validate_manifest(create_default_manifest())
        self.assertTrue(result["valid"])
        paths = self.issue_paths(result)
        self.assertNotIn("entity.url", paths)
        self.assertFalse(any(p.startswith("endpoints.") for p in paths))
        self.assertNotIn("llmsTxtUrl", paths)

    def test_same_origin_absolute_endpoints_accepted(self):
        def mutate(m):
            m["endpoints"]["catalog"] = "https://nymrel.com/api/ucp/catalog"
            m["llmsTxtUrl"] = "https://nymrel.com/llms.txt"
        result = self.validate_mutation(mutate)
        self.assertTrue(result["valid"])

    def test_non_https_entity_url_rejected(self):
        result = self.validate_mutation(lambda m: m.__setitem__("entity", {**m["entity"], "url": "http://nymrel.com"}))
        self.assertFalse(result["valid"])
        self.assertIn("entity.url", self.issue_paths(result))

    def test_loopback_and_private_entity_urls_rejected(self):
        for url in ["https://localhost", "http://127.0.0.1:8080", "https://192.168.1.10", "https://10.0.0.7"]:
            with self.subTest(url=url):
                result = self.validate_mutation(lambda m, u=url: m["entity"].__setitem__("url", u))
                self.assertFalse(result["valid"])
                self.assertIn("entity.url", self.issue_paths(result))

    def test_credential_bearing_entity_url_rejected(self):
        result = self.validate_mutation(lambda m: m["entity"].__setitem__("url", "https://user:pass@nymrel.com"))
        self.assertFalse(result["valid"])
        self.assertIn("entity.url", self.issue_paths(result))

    def test_cross_origin_endpoint_rejected(self):
        result = self.validate_mutation(lambda m: m["endpoints"].__setitem__("checkout", "https://evil.example.com/api/ucp/checkout"))
        self.assertFalse(result["valid"])
        self.assertIn("endpoints.checkout", self.issue_paths(result))

    def test_http_machine_action_urls_rejected(self):
        def mutate(m):
            m["endpoints"]["negotiate"] = "http://nymrel.com/api/ucp/negotiate"
            m["llmsTxtUrl"] = "http://nymrel.com/llms.txt"
        result = self.validate_mutation(mutate)
        self.assertFalse(result["valid"])
        paths = self.issue_paths(result)
        self.assertIn("endpoints.negotiate", paths)
        self.assertIn("llmsTxtUrl", paths)

    def test_credential_bearing_and_malformed_endpoints_rejected(self):
        cred = self.validate_mutation(lambda m: m["endpoints"].__setitem__("catalog", "https://agent:secret@nymrel.com/api/ucp/catalog"))
        self.assertFalse(cred["valid"])
        self.assertIn("endpoints.catalog", self.issue_paths(cred))

        malformed = self.validate_mutation(lambda m: m["endpoints"].__setitem__("catalog", "api/ucp/catalog"))
        self.assertFalse(malformed["valid"])
        self.assertIn("endpoints.catalog", self.issue_paths(malformed))

        proto_relative = self.validate_mutation(lambda m: m["endpoints"].__setitem__("catalog", "//cdn.example.com/api/ucp/catalog"))
        self.assertFalse(proto_relative["valid"])
        self.assertIn("endpoints.catalog", self.issue_paths(proto_relative))

    def test_cross_origin_llms_txt_url_rejected(self):
        result = self.validate_mutation(lambda m: m.__setitem__("llmsTxtUrl", "https://docs.example.net/llms.txt"))
        self.assertFalse(result["valid"])
        self.assertIn("llmsTxtUrl", self.issue_paths(result))


if __name__ == "__main__":
    unittest.main()
