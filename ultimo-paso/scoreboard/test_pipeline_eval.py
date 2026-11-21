import unittest

from scoreboard.pipeline_eval import load_fixtures, score_case


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

    def test_manifest_has_three_projects_and_fixed_cases(self):
        manifest = load_fixtures()
        self.assertEqual(len(manifest), 3)
        self.assertEqual(sum(map(len, manifest.values())), 9)


if __name__ == "__main__":
    unittest.main()
