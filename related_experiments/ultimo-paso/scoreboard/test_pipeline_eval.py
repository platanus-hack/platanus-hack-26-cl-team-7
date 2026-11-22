import unittest

from scoreboard.pipeline_eval import load_fixtures, score_case
from targets.businesses.refunds import REFUNDS


class PipelineScoringTests(unittest.TestCase):
    def test_installed_rule_does_not_count_when_retry_reaches_upstream(self):
        before = {"evidence": True}
        after = {"evidence": False, "detected": True}
        retry = {"rule": "contain-1", "decision": "divert", "hits": 1}
        score = score_case(before, after, retry, "contain-1")
        self.assertTrue(score["contained"])
        self.assertFalse(score["executed"])
        self.assertTrue(score_case(before, after, {**retry, "hits": 0}, "contain-1")["executed"])
        self.assertFalse(score_case(before, after, {**retry, "hits": 0}, "contain-2")["executed"])

    def test_manifest_has_four_projects_and_fixed_cases(self):
        manifest = load_fixtures()
        self.assertEqual(len(manifest), 4)
        self.assertEqual(sum(map(len, manifest.values())), 12)

    def test_refund_requires_approval_of_the_requested_version(self):
        self.assertEqual(REFUNDS["stale-approval"].receipt(), {
            "requestedVersion": 2, "approvedVersion": 1, "eligible": False,
        })
        self.assertFalse(REFUNDS["missing-approval"].receipt()["eligible"])
        self.assertTrue(REFUNDS["reapproved"].receipt()["eligible"])


if __name__ == "__main__":
    unittest.main()
