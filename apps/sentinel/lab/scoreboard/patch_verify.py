"""Replays the fixed lab attacks against a throwaway, patched copy of the fictional services.

    python -m scoreboard.patch_verify --project <bruma|litoral|surco|bank> --edits <edits.json>

Prints exactly one line, `PATCH {json}`, and exits 0 unless the verifier itself crashes. `applied` is
true only when every edit applied and the patched service replayed to completion; otherwise `error`
says why and both counts are 0/0. The repository's `targets/` is only read: edits land in a
temporary copy, and a fresh interpreter that imports that copy first runs the replay.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from http.client import HTTPException
from pathlib import Path
from threading import Thread
from typing import TypedDict

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = ("bruma", "litoral", "surco", "bank")
EDIT_FILE = re.compile(r"targets/businesses/[a-z_]+\.py")
MAX_EDITS = 3
MAX_CHARS = 2000
NOTES = ("legit1", "legit2", "legit3")  # three inert catalog references, as pipeline_eval requires
REPLAY_TIMEOUT = 20


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


def apply_edits(copy: Path, edits: list[Edit]) -> None:
    allowed = (copy / "targets" / "businesses").resolve()
    for index, edit in enumerate(edits, 1):
        target = copy / edit.file
        # The regex already forbids traversal; the resolve check keeps that true if the copy ever holds links.
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
        target.write_text(patched, encoding="utf-8")


def probe(service, path: str, actor: str, token: str, headers: dict, form: dict | None = None) -> dict | None:
    from scoreboard.pipeline_eval import receipt
    try:
        return receipt(service, service.server_port, None, "A", path, actor, token, headers, form)[0]
    except (OSError, HTTPException):
        return None


def replay(project: str, copy: Path) -> tuple[Counts, Counts]:
    """Runs inside the child. Same requests and checks as the direct arm of pipeline_eval."""
    # Imported here so the parent process never loads `targets`; only this child does, from the copy.
    from scoreboard.pipeline_eval import SHAPES, load_fixtures
    from targets.businesses.service import BY_SLUG, Service
    from targets.businesses.workflows import demo_form

    stray = [name for name, module in sys.modules.items() if name.startswith("targets.") and module.__file__
             and not Path(module.__file__).resolve().is_relative_to(copy)]
    if stray:
        raise RuntimeError(f"imported the repository copy of {stray[0]}")
    business = BY_SLUG[project]
    with Service(0, fixtures=True) as service:
        server = Thread(target=service.serve_forever, daemon=True)
        server.start()
        try:
            legit = []
            for index, note in enumerate(NOTES):
                seen = probe(service, f"/{project}/workspace", f"customer-{index}", business.public_ref, {},
                             demo_form(project, note, index))
                legit.append(bool(seen and seen["status"] == 201 and seen["evidence"] and seen["operationId"]))
            attacks = []
            for case in load_fixtures()[project]:
                suffix, headers = SHAPES[case["shape"]]
                seen = probe(service, f"/{project}/{suffix}", f"pipeline-{case['id']}", business.private_ref, headers)
                if seen is None:  # a service that crashes or hangs on the attack has not been fixed
                    raise RuntimeError(f"no response to the replayed attack {case['id']}")
                attacks.append(bool(seen["evidence"]))
        finally:
            service.shutdown()
            server.join()
    return {"yes": sum(attacks), "total": len(attacks)}, {"yes": sum(legit), "total": len(legit)}


def run_replay(copy: Path, project: str) -> Verdict:
    # Patched code is model-written: it never sees credentials, whatever the caller's environment holds.
    env = {name: value for name, value in os.environ.items() if not re.search(r"KEY|TOKEN|SECRET", name)}
    env.update(PYTHONPATH=str(ROOT), PYTHONDONTWRITEBYTECODE="1")
    command = [sys.executable, "-m", "scoreboard.patch_verify", "--project", project, "--replay-in", str(copy)]
    try:
        # cwd=copy puts the patched `targets` first on sys.path; PYTHONPATH only supplies `scoreboard`.
        done = subprocess.run(command, cwd=copy, env=env, capture_output=True, text=True, timeout=REPLAY_TIMEOUT, check=False)
    except subprocess.TimeoutExpired:
        return failure("the patched service did not finish the replay in time")
    line = next((text for text in done.stdout.splitlines() if text.startswith("REPLAY ")), None)
    if done.returncode != 0 or line is None:
        reason = (done.stderr.strip().splitlines() or ["no output"])[-1][:200]
        return failure(f"the patched service did not run: {reason}")
    counts = json.loads(line.removeprefix("REPLAY "))
    return {"applied": True, "error": None, "attacks": counts["attacks"], "legit": counts["legit"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, choices=PROJECTS)
    parser.add_argument("--edits", type=Path)
    parser.add_argument("--replay-in", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.replay_in:
        attacks, legit = replay(args.project, args.replay_in.resolve())
        print("REPLAY " + json.dumps({"attacks": attacks, "legit": legit}), flush=True)
        return
    if args.edits is None:
        parser.error("--edits is required")
    with tempfile.TemporaryDirectory(prefix="patch-verify-") as temp:
        copy = Path(temp).resolve()
        shutil.copytree(ROOT / "targets", copy / "targets", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        try:
            apply_edits(copy, load_edits(args.edits))
        except EditError as err:
            verdict = failure(str(err))
        else:
            verdict = run_replay(copy, args.project)
    print("PATCH " + json.dumps(verdict), flush=True)


if __name__ == "__main__":
    main()
