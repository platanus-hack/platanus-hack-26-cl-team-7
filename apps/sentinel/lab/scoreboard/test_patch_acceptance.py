"""Acceptance tests for scoreboard.patch_verify, through its command line only.

They pin the contract the Sentinel worker relies on: one `PATCH {...}` line, exit 0 for any patch
outcome, edits applied only to a throwaway copy, and the repository's planted weaknesses untouched.
"""
import hashlib
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any

LAB = Path(__file__).resolve().parents[1]
TARGETS = LAB / "targets"
PROJECTS = ("bruma", "litoral", "surco", "bank")
BUDGET_S = 30.0
# Closes the body/record disclosure of bruma and surco: the receipt carries the public reference instead.
CLOSE_RECORD = {"file": "targets/businesses/service.py",
                "old": 'record["reference"] = b.private_ref', "new": 'record["reference"] = b.public_ref'}


def tree_digest(root: Path) -> dict[str, str]:
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file() and "__pycache__" not in p.parts}


def fixture_count(project: str) -> int:
    doc = json.loads((LAB / "attacks" / "fixtures.json").read_text())
    return len(doc["projects"][project])


class PatchVerifyAcceptance(unittest.TestCase):
    def setUp(self) -> None:
        self.before = tree_digest(TARGETS)
        self.edits_dir = tempfile.TemporaryDirectory(prefix="patch-acceptance-")

    def tearDown(self) -> None:
        self.edits_dir.cleanup()
        self.assertEqual(tree_digest(TARGETS), self.before, "the repository target files changed")

    def verify(self, project: str, edits: Any) -> dict[str, Any]:
        file = Path(self.edits_dir.name) / "edits.json"
        file.write_text(json.dumps(edits))
        started = time.monotonic()
        done = subprocess.run([sys.executable, "-m", "scoreboard.patch_verify", "--project", project, "--edits", str(file)],
                              check=False, cwd=LAB, capture_output=True, text=True, timeout=60)
        self.assertLess(time.monotonic() - started, BUDGET_S)
        self.assertEqual(done.returncode, 0, done.stderr[-2000:])
        lines = [line for line in done.stdout.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, done.stdout)
        self.assertTrue(lines[0].startswith("PATCH "), lines[0])
        result: dict[str, Any] = json.loads(lines[0][len("PATCH "):])
        self.assertEqual(set(result), {"applied", "error", "attacks", "legit"})
        return result

    def assert_refused(self, result: dict[str, Any]) -> None:
        self.assertIs(result["applied"], False)
        self.assertIsInstance(result["error"], str)
        self.assertTrue(result["error"])
        self.assertEqual(result["attacks"], {"yes": 0, "total": 0})
        self.assertEqual(result["legit"], {"yes": 0, "total": 0})

    def test_empty_edits_replay_the_hole_for_every_project(self) -> None:
        for project in PROJECTS:
            with self.subTest(project=project):
                result = self.verify(project, [])
                self.assertIs(result["applied"], True)
                self.assertIsNone(result["error"])
                self.assertEqual(result["attacks"]["total"], fixture_count(project))
                self.assertEqual(result["attacks"]["yes"], result["attacks"]["total"])
                self.assertGreater(result["legit"]["total"], 0)
                self.assertEqual(result["legit"]["yes"], result["legit"]["total"])

    def test_a_harmless_edit_applies_to_the_copy_and_the_hole_stays(self) -> None:
        edit = {"file": "targets/businesses/service.py", "old": "def log_message(self, *args):",
                "new": "def log_message(self, *args):  # acceptance: harmless"}
        result = self.verify("surco", [edit])
        self.assertIs(result["applied"], True)
        self.assertEqual(result["attacks"], {"yes": 1, "total": 1})
        self.assertEqual(result["legit"]["yes"], result["legit"]["total"])
        self.assertNotIn("acceptance: harmless", (TARGETS / "businesses" / "service.py").read_text())

    def test_the_replay_imports_the_patched_copy_not_the_repository(self) -> None:
        for project in ("surco", "bruma"):
            with self.subTest(project=project):
                result = self.verify(project, [CLOSE_RECORD])
                self.assertIs(result["applied"], True)
                self.assertIsNone(result["error"])
                self.assertEqual(result["attacks"], {"yes": 0, "total": fixture_count(project)})
                self.assertGreater(result["legit"]["total"], 0)
                self.assertEqual(result["legit"]["yes"], result["legit"]["total"])
        self.assertIn(CLOSE_RECORD["old"], (TARGETS / "businesses" / "service.py").read_text())

    def test_paths_outside_the_allowlist_or_the_copy_are_refused(self) -> None:
        for path in ("targets/businesses/../../x.py", "targets/businesses/../service.py", "/etc/passwd",
                     "../targets/businesses/service.py", "scoreboard/pipeline_eval.py", "targets/businesses/missing_file.py",
                     "targets/businesses/Service.py", "targets/businesses/service.py/../frontend.py", "targets/businesses/workspaces.css"):
            with self.subTest(path=path):
                self.assert_refused(self.verify("surco", [{"file": path, "old": "import", "new": "import"}]))
        self.assertFalse((LAB / "x.py").exists())
        self.assertFalse((LAB.parent / "x.py").exists())

    def test_invalid_edits_are_refused_without_replaying(self) -> None:
        missing = {"file": "targets/businesses/service.py", "old": "this text is not in the file", "new": ""}
        twice = {"file": "targets/businesses/service.py", "old": "self.send_error(404)", "new": "self.send_error(410)"}
        cases: dict[str, Any] = {
            "missing old": [missing],
            "old occurs twice": [twice],
            "valid edit then a missing old": [CLOSE_RECORD, missing],
            "four edits": [CLOSE_RECORD] * 4,
            "empty old": [{**CLOSE_RECORD, "old": ""}],
            "old too long": [{**CLOSE_RECORD, "old": "x" * 2001}],
            "new too long": [{**CLOSE_RECORD, "new": "x" * 2001}],
            "new is not a string": [{**CLOSE_RECORD, "new": 1}],
            "missing key": [{"file": CLOSE_RECORD["file"], "old": CLOSE_RECORD["old"]}],
            "not a list": CLOSE_RECORD,
        }
        for name, edits in cases.items():
            with self.subTest(case=name):
                self.assert_refused(self.verify("surco", edits))


if __name__ == "__main__":
    unittest.main()
