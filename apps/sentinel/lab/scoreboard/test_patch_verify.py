"""Black-box tests: they drive the patch_verify CLI exactly as the experiment worker does."""
import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from collections import Counter
from pathlib import Path
from unittest import mock

from scoreboard import patch_verify

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


ANCHOR = 'STYLE = Path(__file__).with_name("workspaces.css")'
HANG = {"file": SERVICE, "old": ANCHOR, "new": ANCHOR + "\nwhile True:\n    pass"}
SECRET = "sk-ant-FAKE-secret-0123456789"


def add(code: str) -> list[dict]:
    """An edit that appends `code` to the service module right after its STYLE line."""
    return [{"file": SERVICE, "old": ANCHOR, "new": f"{ANCHOR}\n{code}"}]


def processes_under(path: Path) -> list[str]:
    listing = subprocess.run(["ps", "-axo", "command="], capture_output=True, text=True, check=True).stdout
    return [line for line in listing.splitlines() if str(path.resolve()) in line]


class HostileEditTests(unittest.TestCase):
    """The edits are model-written code: none of what they do may leak, forge or linger."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix="pv-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()

    def verify_here(self, project: str, edits: list[dict], timeout: int = 15) -> dict:
        file = self.root / "edits.json"
        file.write_text(json.dumps(edits))
        with mock.patch.object(tempfile, "tempdir", str(self.root)), mock.patch.object(patch_verify, "REPLAY_TIMEOUT", timeout):
            return dict(patch_verify.verify(project, file))

    def test_error_never_carries_what_the_patched_code_wrote(self) -> None:
        cases = {
            "stdout then raise": (f'print("LEAK:{SECRET}")\nraise RuntimeError("LEAK:{SECRET}")', "(RuntimeError)"),
            "attacker-named exception": (f"class LEAK_{SECRET.replace('-', '_')}(Exception):\n    pass\nraise LEAK_{SECRET.replace('-', '_')}()", None),
        }
        for name, (code, kind) in cases.items():
            with self.subTest(name):
                out = verify("bank", add(code))
                self.assertFalse(out["applied"], out)
                self.assertNotIn(SECRET, json.dumps(out))
                self.assertNotIn(SECRET.replace("-", "_"), json.dumps(out))
                self.assertEqual(out["error"], "the patched service did not run" + (f" {kind}" if kind else ""))

    def test_a_forged_result_line_on_stdout_does_not_count(self) -> None:
        forged = '{"attacks": {"yes": 0, "total": 2}, "legit": {"yes": 3, "total": 3}}'
        out = verify("bank", add(f"print('REPLAY ' + '{forged}')"))
        self.assertEqual(out["attacks"], {"yes": 2, "total": 2}, out)

    def test_the_child_environment_is_an_allowlist(self) -> None:
        parent = {"DATABASE_URL": "x", "ANTHROPIC_API_KEY": "k", "AWS_REGION": "r", "PATH": "/usr/bin", "LANG": "C", "LC_ALL": "C", "TMPDIR": "/t"}
        with mock.patch.dict(os.environ, parent, clear=True):
            env = patch_verify.child_env(Path("/temp-copy"))
        self.assertEqual(env, {"PATH": "/usr/bin", "LANG": "C", "LC_ALL": "C", "TMPDIR": "/t", "PYTHONPATH": str(ROOT),
                               "PYTHONDONTWRITEBYTECODE": "1", "HOME": "/temp-copy"})

    def test_a_parent_variable_does_not_reach_the_patched_code(self) -> None:
        # The static check bars `os`, so the probe reaches it through argparse and the check is switched off here.
        # Returning the private reference only when the variable is set makes the leak visible in the replay counts.
        def probe(name: str) -> list[dict]:
            return [{"file": SERVICE, "old": 'record["reference"] = b.private_ref',
                     "new": f'record["reference"] = b.private_ref if argparse._os.environ.get("{name}") else b.public_ref'}]

        with mock.patch.dict(os.environ, {"DATABASE_URL": "x"}), mock.patch.object(patch_verify, "references", return_value=Counter()):
            control = self.verify_here("surco", probe("PATH"))
            hidden = self.verify_here("surco", probe("DATABASE_URL"))
        self.assertEqual(control["attacks"], {"yes": 1, "total": 1}, "the probe must be able to see an allowed variable")
        self.assertEqual(hidden["attacks"], {"yes": 0, "total": 1}, hidden)

    def test_additions_the_static_check_refuses(self) -> None:
        cases = {
            "import": "import os",
            "from import": "from os import path",
            "open": 'DATA = open("/etc/passwd")',
            "__import__": '_os = __import__("os")',
            "dunder attribute": "KIND = ().__class__",
            "dunder name": 'OPEN = __builtins__["open"]',
            "getattr": 'KIND = getattr(Path, "x", None)',
            "os name": "KIND = os",
            "door through a module": "KIND = argparse._os",
            "Path": 'DATA = Path("/etc/passwd").read_text()',
            "frame walk": "GEN = (x for x in ())\nFRAME = GEN.gi_frame",
            "frame parent": "FRAME = type(GEN).f_back",
            "frame locals": "LOCALS = GEN.f_locals",
            "module chain": "KIND = json.decoder.re.NOFLAG",
        }
        for name, code in cases.items():
            with self.subTest(name):
                out = verify("bank", add(code))
                self.assertFalse(out["applied"], out)
                self.assertEqual(out["error"], "the patch adds a forbidden construct")
                self.assertEqual((out["attacks"], out["legit"]), ({"yes": 0, "total": 0}, {"yes": 0, "total": 0}))

    def test_constructs_the_original_already_has_are_not_refused(self) -> None:
        self.assertEqual(verify("bank", add("KIND = Path"))["error"], "the patch adds a forbidden construct")
        self.assertTrue(verify("bank", [{"file": SERVICE, "old": "def log_message(self, *args):",
                                         "new": "def log_message(self, *args):  # __init__ __name__ Path argparse"}])["applied"])

    def test_a_wider_import_line_is_refused(self) -> None:
        for name, (old, new) in {"extra module": ("import json\n", "import json, os\n"),
                                 "alias": ("import json\n", "import json as js\n"),
                                 "extra name": ("from collections import Counter\n", "from collections import Counter, abc\n")}.items():
            with self.subTest(name):
                out = verify("bank", [{"file": SERVICE, "old": old, "new": new}])
                self.assertEqual(out, patch_verify.failure("the patch adds a forbidden construct"))

    def test_the_pipe_and_the_job_of_the_child_hold_no_verdict(self) -> None:
        # Bypass A and B of the independent review, with the static check switched off: the patched interpreter used
        # to hold the nonce, the result pipe and the counts. Now it holds none, so the replay reports the true leak.
        walk = ("import json\ndef walker():\n    yield GEN.gi_frame.f_back\nGEN = walker()\nfr = next(GEN)\n"
                "while fr is not None and 'job' not in fr.f_locals:\n    fr = fr.f_back\n"
                "if fr is not None:\n    jj = fr.f_locals['job']\n    oo = fr.f_globals['os']\n"
                "    oo.write(jj['fd'], json.dumps({'nonce': jj['nonce'], 'attacks': {'yes': 0, 'total': 5}, "
                "'legit': {'yes': 3, 'total': 3}}).encode())\n    oo.kill(oo.getpid(), 9)\n")
        wide = ("import json, inspect as ii, os as oo\nf = ii.currentframe()\n"
                "while f is not None and 'job' not in f.f_locals:\n    f = f.f_back\n"
                "if f is not None:\n    j = f.f_locals['job']\n    oo.write(j['fd'], json.dumps({'nonce': j['nonce'], "
                "'attacks': {'yes': 0, 'total': 5}, 'legit': {'yes': 3, 'total': 3}}).encode())\n    oo.kill(oo.getpid(), 9)\n")
        pipe = ("import json\nargparse._os.write(int(argparse._sys.argv[-1]), b'{\"attacks\": {\"yes\": 0, \"total\": 1}, "
                '\"legit\": {\"yes\": 3, \"total\": 3}}\\n\')\nargparse._os._exit(0)\n')
        for name, new in {"generator frame walk": walk, "inspect in a wider import": wide, "forged line on the ready pipe": pipe}.items():
            edit = [{"file": SERVICE, "old": "import json\n", "new": new}]
            with self.subTest(name):
                if name != "forged line on the ready pipe":  # the static check refuses these before anything runs
                    self.assertEqual(verify("bruma", edit), patch_verify.failure("the patch adds a forbidden construct"))
                with mock.patch.object(patch_verify, "references", return_value=Counter()):
                    out = self.verify_here("bruma", edit)
                self.assertNotEqual(out["attacks"], {"yes": 0, "total": 5}, out)
                if out["applied"]:
                    cases = len(FIXTURES["bruma"])
                    self.assertEqual((out["attacks"], out["legit"]), ({"yes": cases, "total": cases}, {"yes": 3, "total": 3}))
                else:
                    self.assertEqual(out["error"], "the patched service did not run")

    def test_a_ready_report_that_is_not_a_plain_port_is_refused(self) -> None:
        refs = ("PUB", "PRIV")
        for name, report in {"port too low": {"port": 80, "refs": ["PUB", "PRIV"]}, "port as text": {"port": "9000", "refs": ["PUB", "PRIV"]},
                             "port as bool": {"port": True, "refs": ["PUB", "PRIV"]}, "no port": {"refs": ["PUB", "PRIV"]},
                             "result instead": {"attacks": {"yes": 0, "total": 2}}}.items():
            with self.subTest(name), self.assertRaises(patch_verify.ReplayError):
                patch_verify.parse_ready(json.dumps(report).encode(), refs)
        with self.assertRaises(patch_verify.ReplayError):
            patch_verify.parse_ready(b"{" * 5000, refs)
        with self.assertRaisesRegex(patch_verify.ReplayError, "canary"):
            patch_verify.parse_ready(b'{"port": 9000, "refs": ["PUB", "OTHER"]}', refs)
        self.assertEqual(patch_verify.parse_ready(b'{"port": 9000, "refs": ["PUB", "PRIV"]}\n', refs), 9000)

    def test_the_canary_cannot_be_forged(self) -> None:
        for edit in ({"file": SERVICE, "old": "PROOF-6408", "new": ""},
                     {"file": SERVICE, "old": "BP-425", "new": "BP-426"},
                     {"file": SERVICE, "old": ANCHOR, "new": ANCHOR + '\nFORGED = "PROOF-6408"'}):
            with self.subTest(edit["new"][-20:]):
                out = verify("bruma", [edit])
                self.assertEqual(out, patch_verify.failure("the patch changed the canary"))

    def test_a_canary_rebuilt_without_naming_it_is_caught_in_the_replay(self) -> None:
        swap = ("BUSINESSES = tuple(type(b)(*(x if x != b.private_ref else 'ZZZ-1' for x in (b.slug, b.name, b.sector, "
                "b.description, b.service, b.detail, b.public_ref, b.private_ref, b.accent, b.surface))) for b in BUSINESSES)")
        edit = {"file": SERVICE, "old": "BY_SLUG = {b.slug: b for b in BUSINESSES}", "new": swap + "\nBY_SLUG = {b.slug: b for b in BUSINESSES}"}
        self.assertEqual(verify("bruma", [edit]), patch_verify.failure("the patch changed the canary"))

    def test_a_hanging_import_times_out_and_leaves_nothing_behind(self) -> None:
        started = time.monotonic()
        out = self.verify_here("bank", [HANG], timeout=3)
        self.assertLess(time.monotonic() - started, 20)
        self.assertEqual(out, patch_verify.failure("the patched service did not finish the replay in time"))
        self.assertEqual(list(self.root.glob("patch-verify-*")), [])
        self.assertEqual(processes_under(self.root), [])

    def test_a_forked_grandchild_does_not_survive_the_timeout(self) -> None:
        fork = "if argparse._os.fork() == 0:\n    while True:\n        pass\nwhile True:\n    pass"
        with mock.patch.object(patch_verify, "references", return_value=Counter()):
            out = self.verify_here("bank", add(fork), timeout=3)
        self.assertFalse(out["applied"], out)
        self.assertEqual(processes_under(self.root), [])
        self.assertEqual(list(self.root.glob("patch-verify-*")), [])

    def test_sigterm_from_the_caller_kills_the_replay_and_removes_the_copy(self) -> None:
        file = self.root / "edits.json"
        file.write_text(json.dumps([HANG]))
        env = {**os.environ, "TMPDIR": str(self.root)}
        proc = subprocess.Popen([sys.executable, "-m", "scoreboard.patch_verify", "--project", "bank", "--edits", str(file)],
                                cwd=ROOT, env=env, stdout=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 10
        while not processes_under(self.root) and time.monotonic() < deadline:
            time.sleep(0.1)
        self.assertTrue(processes_under(self.root), "the replay child never started")
        proc.send_signal(signal.SIGTERM)
        proc.communicate(timeout=10)
        self.assertEqual(proc.returncode, 128 + signal.SIGTERM)
        self.assertEqual(processes_under(self.root), [])
        self.assertEqual(list(self.root.glob("patch-verify-*")), [])


@unittest.skipUnless(sys.platform == "darwin" and Path("/usr/bin/sandbox-exec").exists(), "sandbox-exec is macOS only")
class SandboxTests(unittest.TestCase):
    def test_writes_stay_in_the_copy_and_only_loopback_is_reachable(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pv-sandbox-") as raw, tempfile.TemporaryDirectory(prefix="pv-outside-") as other:
            temp = Path(raw).resolve()
            probe = (
                "import socket, pathlib, sys\n"
                "def ok(f):\n    try:\n        f(); return 'yes'\n    except OSError:\n        return 'no'\n"
                "l = socket.socket(); l.bind(('127.0.0.1', 0)); l.listen()\n"
                "print(ok(lambda: pathlib.Path(sys.argv[1], 'a').write_text('x')),\n"
                "      ok(lambda: pathlib.Path(sys.argv[2], 'a').write_text('x')),\n"
                "      ok(lambda: socket.create_connection(('127.0.0.1', l.getsockname()[1]), 2)),\n"
                "      ok(lambda: socket.create_connection(('203.0.113.1', 9), 2)))\n")
            command = ["/usr/bin/sandbox-exec", "-D", f"TEMP={temp}", "-p", patch_verify.SANDBOX_PROFILE, sys.executable, "-c", probe, str(temp), other]
            done = subprocess.run(command, capture_output=True, text=True, check=False, timeout=30)
            self.assertEqual(done.stdout.split(), ["yes", "no", "yes", "no"], done.stderr)
            self.assertFalse((Path(other) / "a").exists())


if __name__ == "__main__":
    unittest.main()
