"""Replays the fixed lab attacks against a throwaway, patched copy of the fictional services.

    python -m scoreboard.patch_verify --project <bruma|litoral|surco|bank> --edits <edits.json>

Prints exactly one line, `PATCH {json}`, and exits 0 unless the verifier itself crashes. `applied` is true
only when every edit applied and the patched service replayed to completion; otherwise `error` says why and
both counts are 0/0. `targets/` is only read: edits land in a temporary copy that a fresh interpreter imports.

The edits are MODEL-WRITTEN code, so the replay is treated as hostile: `error` is a fixed message (never
text the patched code produced), the child gets an allowlisted environment, its own process group and,
on macOS, a sandbox; the canaries are pinned from the repository; the result returns over a private pipe.
"""
import argparse
import ast
import builtins
import contextlib
import json
import os
import re
import secrets
import select
import shutil
import signal
import subprocess
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass
from http.client import HTTPException
from pathlib import Path
from threading import Thread
from typing import Any, TypedDict

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = ("bruma", "litoral", "surco", "bank")
EDIT_FILE = re.compile(r"targets/businesses/[a-z_]+\.py")
MAX_EDITS = 3
MAX_CHARS = 2000
NOTES = ("legit1", "legit2", "legit3")  # three inert catalog references, as pipeline_eval requires
REPLAY_TIMEOUT = 15
SANDBOX_EXEC = Path("/usr/bin/sandbox-exec")
# Denies every connection but loopback and every write outside the temp copy (and /dev/null, /dev/tty).
SANDBOX_PROFILE = ('(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
                   '(deny file-write*)(allow file-write* (subpath (param "TEMP")) (literal "/dev/null") (literal "/dev/tty"))')
# Constructs a patch may not add: the original files already use some, so only an increase is refused.
# `Path`, `argparse` and underscore attributes (`argparse._os`) are the doors the service module itself leaves open.
FORBIDDEN = frozenset((
    "open", "exec", "eval", "compile", "__import__", "getattr", "setattr", "delattr", "globals", "locals", "vars",
    "breakpoint", "input", "os", "sys", "subprocess", "socket", "importlib", "builtins", "shutil", "pathlib", "ctypes",
    "signal", "Path", "argparse"))
MESSAGES = {"canary": "the patch changed the canary",
            "no_response": "the patched service gave no response to the replayed attack"}
CRASH_ERROR = "the patched service did not run"
LIVE: list[subprocess.Popen[str]] = []  # replay children, so a signal can kill their process groups
TEMPS: list[Path] = []


class Counts(TypedDict):
    yes: int
    total: int


class Verdict(TypedDict):
    applied: bool
    error: str | None
    attacks: Counts
    legit: Counts


@dataclass(frozen=True)
class Edit:
    file: str
    old: str
    new: str


class EditError(ValueError):
    pass


def failure(error: str) -> Verdict:
    return {"applied": False, "error": error, "attacks": {"yes": 0, "total": 0}, "legit": {"yes": 0, "total": 0}}


def load_edits(path: Path) -> list[Edit]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise EditError("edits file is not readable JSON") from err
    if not isinstance(raw, list) or len(raw) > MAX_EDITS:
        raise EditError(f"edits must be a list of at most {MAX_EDITS} items")
    edits = []
    for index, item in enumerate(raw, 1):
        if (not isinstance(item, dict) or set(item) != {"file", "old", "new"} or
                not all(isinstance(value, str) for value in item.values()) or
                not EDIT_FILE.fullmatch(item["file"]) or
                not 1 <= len(item["old"]) <= MAX_CHARS or len(item["new"]) > MAX_CHARS):
            raise EditError(f"edit {index} is outside the PatchEdit shape")
        edits.append(Edit(item["file"], item["old"], item["new"]))
    return edits


def pin_refs() -> dict[str, tuple[str, str]]:
    """Reads (public_ref, private_ref) per project from the repository service, never from the copy."""
    tree = ast.parse((ROOT / "targets/businesses/service.py").read_text(encoding="utf-8"))
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
             and node.func.id == "Business"]
    return {ast.literal_eval(c.args[0]): (ast.literal_eval(c.args[6]), ast.literal_eval(c.args[7])) for c in calls}


def references(source: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            counts["import"] += 1
        name = node.id if isinstance(node, ast.Name) else node.attr if isinstance(node, ast.Attribute) else None
        if name and (name in FORBIDDEN or (name.startswith("__") and name.endswith("__")) or
                     (isinstance(node, ast.Attribute) and name.startswith("_"))):
            counts[name] += 1
    return counts


def apply_edits(copy: Path, edits: list[Edit], canaries: set[str]) -> None:
    allowed = (copy / "targets" / "businesses").resolve()
    originals: dict[str, str] = {}
    for index, edit in enumerate(edits, 1):
        if any(ref in edit.old or ref in edit.new for ref in canaries):
            raise EditError(MESSAGES["canary"])
        target = copy / edit.file
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(allowed):
            raise EditError(f"edit {index}: {edit.file} is not a service file")
        text = target.read_text(encoding="utf-8")
        found = text.count(edit.old)
        if found != 1:
            raise EditError(f"edit {index}: old text found {found} times, expected exactly once")
        patched = text.replace(edit.old, edit.new)
        try:
            compile(patched, edit.file, "exec")
        except (SyntaxError, ValueError) as err:
            raise EditError(f"edit {index}: the patched file does not compile ({type(err).__name__})") from err
        originals.setdefault(edit.file, text)
        target.write_text(patched, encoding="utf-8")
    for file, original in originals.items():
        if references((copy / file).read_text(encoding="utf-8")) - references(original):
            raise EditError("the patch adds a forbidden construct")


def probe(service: Any, path: str, actor: str, token: str, headers: dict, form: dict | None = None) -> dict | None:
    from scoreboard.pipeline_eval import receipt
    try:
        return receipt(service, service.server_port, None, "A", path, actor, token, headers, form)[0]
    except (OSError, HTTPException):
        return None


def replay(project: str, copy: Path, public_ref: str, private_ref: str) -> dict[str, Any]:
    """Runs inside the child. Same requests and checks as the direct arm of pipeline_eval, with pinned canaries."""
    # Imported here so the parent process never loads `targets`; only this child does, from the copy.
    from scoreboard.pipeline_eval import SHAPES, load_fixtures
    from targets.businesses.service import BY_SLUG, Service
    from targets.businesses.workflows import demo_form

    stray = [name for name, module in sys.modules.items() if name.startswith("targets.") and module.__file__
             and not Path(module.__file__).resolve().is_relative_to(copy)]
    if stray:
        raise RuntimeError("imported the repository copy of the service")
    business = BY_SLUG[project]
    if (business.public_ref, business.private_ref) != (public_ref, private_ref):
        return {"error": "canary"}
    with Service(0, fixtures=True) as service:
        server = Thread(target=service.serve_forever, daemon=True)
        server.start()
        try:
            legit = []
            for index, note in enumerate(NOTES):
                seen = probe(service, f"/{project}/workspace", f"customer-{index}", public_ref, {},
                             demo_form(project, note, index))
                legit.append(bool(seen and seen["status"] == 201 and seen["evidence"] and seen["operationId"]))
            attacks = []
            for case in load_fixtures()[project]:
                suffix, headers = SHAPES[case["shape"]]
                seen = probe(service, f"/{project}/{suffix}", f"pipeline-{case['id']}", private_ref, headers)
                if seen is None:  # a service that crashes or hangs on the attack has not been fixed
                    return {"error": "no_response"}
                attacks.append(bool(seen["evidence"]))
        finally:
            service.shutdown()
            server.join()
    return {"attacks": {"yes": sum(attacks), "total": len(attacks)}, "legit": {"yes": sum(legit), "total": len(legit)}}


def child_main(project: str, copy: Path) -> None:
    """The replay child: reads its pins and result pipe from stdin, answers only over that pipe."""
    job = json.loads(sys.stdin.read())
    try:
        result = replay(project, copy, job["public_ref"], job["private_ref"])
    except BaseException as err:  # noqa: BLE001 - the patched code may raise anything, including SystemExit
        result = {"error": "crash", "type": type(err).__name__}
    with os.fdopen(job["fd"], "w") as pipe:
        pipe.write(json.dumps({**result, "nonce": job["nonce"]}))


def child_env(temp: Path) -> dict[str, str]:
    env = {name: os.environ[name] for name in ("PATH", "LANG", "LC_ALL", "TMPDIR") if name in os.environ}
    return {**env, "PYTHONPATH": str(ROOT), "PYTHONDONTWRITEBYTECODE": "1", "HOME": str(temp)}  # cwd=copy wins sys.path


def kill_group(proc: subprocess.Popen[str]) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)
    proc.wait()


def parse_result(raw: bytes, nonce: str) -> Verdict:
    try:
        result = json.loads(raw)
        if result["nonce"] != nonce:
            raise ValueError("not our child")
        if result.get("error") in MESSAGES:
            return failure(MESSAGES[result["error"]])
        if result.get("error") == "crash":
            kind = getattr(builtins, str(result.get("type")), None)  # a name the patched code chose: builtins only
            known = isinstance(kind, type) and issubclass(kind, BaseException)
            return failure(f"{CRASH_ERROR} ({kind.__name__})" if known else CRASH_ERROR)
        attacks, legit = (result[key] for key in ("attacks", "legit"))
        return {"applied": True, "error": None, "attacks": attacks, "legit": legit}  # nonce-authenticated, ours
    except (ValueError, KeyError, TypeError, AttributeError):
        return failure(CRASH_ERROR)


def run_replay(temp: Path, project: str, refs: tuple[str, str]) -> Verdict:
    nonce = secrets.token_hex(16)
    read_fd, write_fd = os.pipe()
    command = [sys.executable, "-m", "scoreboard.patch_verify", "--project", project, "--replay-in", str(temp)]
    if sys.platform == "darwin" and SANDBOX_EXEC.exists():
        command = [str(SANDBOX_EXEC), "-D", f"TEMP={temp}", "-p", SANDBOX_PROFILE, *command]
    with os.fdopen(read_fd, "rb", buffering=0) as reader:
        try:  # output goes nowhere: a spamming child cannot fill memory and nothing it prints reaches `error`
            proc = subprocess.Popen(command, cwd=temp, env=child_env(temp), stdin=subprocess.PIPE, text=True,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, pass_fds=(write_fd,),
                                    start_new_session=True)
        finally:
            os.close(write_fd)
        LIVE.append(proc)
        job = json.dumps({"public_ref": refs[0], "private_ref": refs[1], "fd": write_fd, "nonce": nonce})
        try:
            proc.communicate(job, timeout=REPLAY_TIMEOUT)
        except subprocess.TimeoutExpired:
            return failure("the patched service did not finish the replay in time")
        finally:
            kill_group(proc)  # also reaps anything the patched code left behind
            LIVE.remove(proc)
        return parse_result(reader.read(65536) if select.select([reader], [], [], 0)[0] else b"", nonce)


def verify(project: str, edits_file: Path) -> Verdict:
    pins = pin_refs()  # before any edit: the copy below is the only thing the model's text can change
    temp = Path(tempfile.mkdtemp(prefix="patch-verify-")).resolve()
    TEMPS.append(temp)
    try:
        shutil.copytree(ROOT / "targets", temp / "targets", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        try:
            apply_edits(temp, load_edits(edits_file), {ref for pair in pins.values() for ref in pair})
        except EditError as err:
            return failure(str(err))
        return run_replay(temp, project, pins[project])
    finally:
        shutil.rmtree(temp, ignore_errors=True)
        TEMPS.remove(temp)


def abort(signum: int, _frame: object) -> None:
    """An abort from the caller (uv forwards SIGTERM) leaves no replay process and no temp directory."""
    for proc in LIVE:
        kill_group(proc)
    for temp in TEMPS:
        shutil.rmtree(temp, ignore_errors=True)
    raise SystemExit(128 + signum)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, choices=PROJECTS)
    parser.add_argument("--edits", type=Path)
    parser.add_argument("--replay-in", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.replay_in:
        child_main(args.project, args.replay_in.resolve())
        return
    if args.edits is None:
        parser.error("--edits is required")
    signal.signal(signal.SIGTERM, abort)
    signal.signal(signal.SIGINT, abort)
    print("PATCH " + json.dumps(verify(args.project, args.edits)), flush=True)


if __name__ == "__main__":
    main()
