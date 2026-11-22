"""Build Sentinel's offline demo from saved observations and an inert detector replay."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from engine.config import Thresholds
from engine.detector import Detector
from engine.models import Request
from engine.routes import RouteTable

ROOT = Path(__file__).resolve().parents[2]
BANK_ARTIFACT = ROOT / "related_experiments/ultimo-paso/scoreboard/results/mock-bank.json"
BUNDLE_PATH = ROOT / "apps/sentinel/src/evidence-demo/bundle.json"
BANK_RUN = "mock-bank-recorded"
DETECTOR_RUN = "mock-bank-detector-synthetic"
MOCK_BANK_PATHS = ("/", "/login", "/accounts/{id}", "/statements/{id}", "/export", "/healthz")
BENIGN_PATHS = ("/", "/accounts/demo", "/statements/demo", "/healthz", "/")
UNLISTED_PATHS = tuple(f"/demo-unlisted-{i}" for i in range(1, 6))


@dataclass
class Trial:
    run_id: str
    trial_id: str
    ordinal: int
    profile: str
    observations: list[dict[str, object]] = field(default_factory=list)

    def append(
        self, source: str, kind: str, timestamp: str | None = None, **outcome: object
    ) -> None:
        sequence = len(self.observations) + 1
        self.observations.append({
            "id": f"{self.trial_id}:{sequence}",
            "runId": self.run_id,
            "trialId": self.trial_id,
            "sequence": sequence,
            "source": source,
            "kind": kind,
            "timestamp": timestamp,
            **outcome,
        })

    def data(self) -> dict[str, object]:
        return {
            "id": self.trial_id,
            "ordinal": self.ordinal,
            "profile": self.profile,
            "observations": self.observations,
        }


def recorded_trials(artifact: Path) -> list[dict[str, object]]:
    saved = json.loads(artifact.read_text(encoding="utf-8"))
    if saved["target"] != "mock-bank":
        raise ValueError("Expected the saved mock-bank evaluation")
    trials = []
    for profile in ("scripted", "benign"):
        for input_arm, arm in [("unprotected", "direct"), ("protected", "protected")]:
            for ordinal, result in enumerate(saved["arms"][profile][input_arm], 1):
                trial_id = f"{BANK_RUN}:{profile}:{arm}:{ordinal}"
                trial = Trial(BANK_RUN, trial_id, ordinal, profile)
                for index, response in enumerate(result["transcript"], 1):
                    trial.append(
                        "client", "response", ordinal=index, status=response["status"],
                        disclosed=response.get("leaked"), blocked=response.get("blocked"),
                    )
                if profile == "scripted":
                    trial.append("client", "disclosure", disclosed=result["evidence_leaked"])
                    trial.append("backend", "execution", executed=result["backend_executed"])
                trials.append({**trial.data(), "arm": arm})
    return trials


def detector_trials(first: str = "benign") -> list[dict[str, object]]:
    routes = RouteTable.from_patterns([{"pattern": path} for path in MOCK_BANK_PATHS])
    detector = Detector(routes, Thresholds())
    trials = []
    profiles = (("benign", BENIGN_PATHS), ("unlisted", UNLISTED_PATHS))
    if first == "unlisted":
        profiles = profiles[::-1]
    for index, (profile, paths) in enumerate(profiles, 1):
        trial = Trial(DETECTOR_RUN, f"{DETECTOR_RUN}:{profile}", index, profile)
        for ordinal, path in enumerate(paths, 1):
            ts = 1_700_000_000 + index * 10 + ordinal
            request = Request(ts, f"192.0.2.{index}", "Sentinel evidence demo", "GET", path, "")
            timestamp = datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z")
            listed = routes.match(request.method, request.path) is not None
            trial.append(
                "fixture", "route", timestamp, ordinal=ordinal, method=request.method,
                path=request.path, listed=listed,
            )
            for verdict in detector.process(request):
                trial.append(
                    "agent-detection", "verdict", timestamp, ordinal=verdict.request_count,
                    rule=verdict.rule, reason=verdict.reason,
                )
        trials.append(trial.data())
    return trials


def build_bundle(artifact: Path = BANK_ARTIFACT) -> dict[str, object]:
    return {"version": 1, "runs": [
        {"id": BANK_RUN, "kind": "recorded-bank", "trials": recorded_trials(artifact)},
        {"id": DETECTOR_RUN, "kind": "synthetic-detector", "trials": detector_trials()},
    ]}


def render_bundle() -> str:
    return json.dumps(build_bundle(), indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check the checked-in replay bundle")
    parser.add_argument("--detector-first", choices=("benign", "unlisted"))
    args = parser.parse_args()
    if args.detector_first:
        print(json.dumps({"id": DETECTOR_RUN, "kind": "synthetic-detector",
                          "trials": detector_trials(args.detector_first)}))
        return
    bundle = render_bundle()
    if args.check:
        if not BUNDLE_PATH.is_file() or BUNDLE_PATH.read_text(encoding="utf-8") != bundle:
            parser.exit(1, "Evidence bundle is stale. Run python -m scripts.evidence_demo\n")
        return
    BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    BUNDLE_PATH.write_text(bundle, encoding="utf-8")


if __name__ == "__main__":
    main()
