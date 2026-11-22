"""Black-box tests: they drive the patch_verify CLI exactly as the experiment worker does."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads((ROOT / "attacks" / "fixtures.json").read_text())["projects"]
SERVICE = "targets/businesses/service.py"
LEAK = 'record["reference"] = b.private_ref'
SAFE = 'record["reference"] = b.public_ref'
# One minimal known-good patch per project: the fixture route returns the public reference instead of the private one.
GOOD = {
    "bruma": [{"file": SERVICE, "old": LEAK, "new": SAFE}],
    "surco": [{"file": SERVICE, "old": LEAK, "new": SAFE}],
    "litoral": [
        {"file": SERVICE, "old": 'headers.append(("X-Receipt-Reference", b.private_ref))',
         "new": 'headers.append(("X-Receipt-Reference", b.public_ref))'},
        {"file": SERVICE, "old": '("X-Receipt-Reference", BUSINESSES[1].private_ref),',
         "new": '("X-Receipt-Reference", BUSINESSES[1].public_ref),'},
    ],
    "bank": [{"file": SERVICE, "old": 'reference = bank.public_ref if receipt["eligible"] else bank.private_ref',
              "new": "reference = bank.public_ref"}],
}


def verify(project: str, edits: object) -> dict:
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / "edits.json"
        path.write_text(edits if isinstance(edits, str) else json.dumps(edits))
        done = subprocess.run([sys.executable, "-m", "scoreboard.patch_verify", "--project", project, "--edits", str(path)],
                              cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
    assert done.returncode == 0, done.stderr
    lines = done.stdout.splitlines()
    assert len(lines) == 1 and lines[0].startswith("PATCH "), done.stdout
    return json.loads(lines[0].removeprefix("PATCH "))


def tree_hash() -> str:
    digest = hashlib.sha256()
    for file in sorted(p for p in (ROOT / "targets").rglob("*") if p.is_file() and "__pycache__" not in p.parts):
        digest.update(file.relative_to(ROOT).as_posix().encode() + file.read_bytes())
    return digest.hexdigest()


class PatchVerifyTests(unittest.TestCase):
    def test_unpatched_copy_still_leaks_and_serves_customers(self):
        for project, cases in FIXTURES.items():
            with self.subTest(project=project):
                out = verify(project, [])
                self.assertTrue(out["applied"], out)
                self.assertEqual(out["attacks"], {"yes": len(cases), "total": len(cases)})
                self.assertEqual(out["legit"], {"yes": 3, "total": 3})

    def test_known_good_patch_closes_the_hole_and_keeps_customers(self):
        for project, cases in FIXTURES.items():
            with self.subTest(project=project):
                out = verify(project, GOOD[project])
                self.assertEqual(out, {"applied": True, "error": None, "attacks": {"yes": 0, "total": len(cases)},
                                       "legit": {"yes": 3, "total": 3}})

    def test_a_patch_that_breaks_customers_is_visible_in_the_counts(self):
        edits = [{"file": SERVICE, "old": 'if self.headers.get("Sec-Fetch-Site") == "cross-site":', "new": "if True:"}]
        out = verify("bank", edits)
        self.assertTrue(out["applied"], out)
        self.assertEqual(out["attacks"], {"yes": 2, "total": 2})
        self.assertEqual(out["legit"], {"yes": 0, "total": 3})

    def test_a_patch_that_crashes_the_attacked_route_is_not_a_fix(self):
        edits = [{"file": SERVICE, "old": "def do_GET(self):\n", "new": "def do_GET(self):\n        raise RuntimeError('boom')\n"}]
        out = verify("bank", edits)
        self.assertFalse(out["applied"], out)
        self.assertIn("no response to the replayed attack", out["error"])

    def test_invalid_edits_are_reported_not_crashed(self):
        good = GOOD["bank"][0]
        cases = {
            "traversal": [{**good, "file": "targets/businesses/../../scoreboard/wire.py"}],
            "absolute": [{**good, "file": "/etc/passwd"}],
            "outside targets": [{**good, "file": "scoreboard/wire.py"}],
            "missing file": [{**good, "file": "targets/businesses/nothing.py"}],
            "missing old": [{**good, "old": "this text is not in the file"}],
            "ambiguous old": [{**good, "old": "self"}],
            "empty old": [{**good, "old": ""}],
            "too many": [good] * 4,
            "syntax error": [{**good, "new": "reference = ("}],
            "extra key": [{**good, "mode": "w"}],
            "not a list": {"edits": []},
            "not json": "{",
        }
        for name, edits in cases.items():
            with self.subTest(name):
                out = verify("bank", edits)
                self.assertFalse(out["applied"], out)
                self.assertTrue(out["error"])
                self.assertEqual((out["attacks"], out["legit"]), ({"yes": 0, "total": 0}, {"yes": 0, "total": 0}))

    def test_the_repository_targets_never_change(self):
        before = tree_hash()
        for project in ("litoral", "bank"):
            verify(project, GOOD[project])
        verify("bank", [{**GOOD["bank"][0], "file": "targets/businesses/../x.py"}])
        self.assertEqual(tree_hash(), before)


if __name__ == "__main__":
    unittest.main()
