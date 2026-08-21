"""
Unit tests for open_ucp Validator Suite (Python)
"""

import unittest
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


if __name__ == "__main__":
    unittest.main()
