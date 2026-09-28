#!/usr/bin/env python
"""Measure the sim -> arm joint map by matching two poses.

The studio's joint values are the URDF's radians. The arm's are LeRobot's
calibrated degrees, zeroed on the midpoint of whatever range you swept during
calibration. Those differ by a per-joint sign and a constant, and no amount of
reading either codebase reveals them -- they depend on how you calibrated. So
measure them:

    1. The arm goes limp (torque off).
    2. You pose the studio somewhere distinctive and hand-pose the real arm to
       match it, then press Enter. That is one (sim radians, arm degrees) pair
       per joint.
    3. Repeat, at poses that differ a lot, until you type "d".

Two points are the minimum but a poor measurement: matching by eye is only
good to a few degrees, and with two points that error goes straight into the
offset. Four or five poses average it out. Each joint is fitted independently
over every pose, so a joint that swung widely is well determined even if
another barely moved in the same set.

Three numbers are reported per joint. `spread` is how far that joint travelled
across your poses -- a joint that hardly moved cannot have its sign measured,
and the tool says so instead of reporting a coin flip. `residual` is the worst
mismatch after fitting. `slope` is what a free fit wanted: it should be near
1.0, and a slope like 0.85 means your matches were systematically short rather
than randomly noisy, which no amount of extra poses will fix.

    python drivers/jog.py --port /dev/cu.usbmodemXXXX --id follower

Requires the studio running with the Bridge button connected, so the live sim
pose can be read from the server's /api/state.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
BODY = JOINTS[:5]
GRIPPER_RAD_MAX = 1.74533
MAP_PATH = Path(__file__).with_name("joint_map.json")


def read_sim(api: str) -> list[float]:
    """Latest joint vector the studio streamed to the bridge."""
    try:
        with urllib.request.urlopen(f"{api}/api/state", timeout=2) as resp:
            state = json.load(resp)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise SystemExit(f"cannot read {api}/api/state: {exc}\nIs the bridge server running?") from exc

    cmd = state.get("lastCommand")
    if not cmd or not isinstance(cmd.get("joints"), list) or len(cmd["joints"]) != 6:
        raise SystemExit(
            "the bridge has no joint frames yet - open the studio and press the Bridge button to link it"
        )
    return [float(v) for v in cmd["joints"]]


def capture(robot, api: str, index: int) -> tuple[list[float], dict[str, float]]:
    sim = read_sim(api)
    obs = robot.get_observation()
    arm = {j: float(obs[f"{j}.pos"]) for j in JOINTS}
    print(f"  captured pose {index}")
    print("  sim (deg): " + "  ".join(f"{j}={math.degrees(sim[i]):7.1f}" for i, j in enumerate(BODY)))
    print("  arm (deg): " + "  ".join(f"{j}={arm[j]:7.1f}" for j in BODY))
    print(f"  gripper:  sim {sim[5] / GRIPPER_RAD_MAX * 100:5.1f}%   arm {arm['gripper']:5.1f}%")
    return sim, arm


def fit(xs: list[float], ys: list[float]) -> tuple[int, float, float, float]:
    """Least squares with the slope pinned to +/-1, plus the free slope.

    The physical slope is exactly +/-1 -- both sides measure the same joint in
    degrees -- so the fit only has to choose a direction and a constant. The
    free slope is computed alongside purely as a quality signal: it is what the
    data *wanted*, and how far it sits from 1.0 says how good the matching was.
    """
    n = len(xs)
    best = None
    for sign in (1, -1):
        offset = sum(y - sign * x for x, y in zip(xs, ys)) / n
        residual = max(abs(y - (sign * x + offset)) for x, y in zip(xs, ys))
        rms = (sum((y - (sign * x + offset)) ** 2 for x, y in zip(xs, ys)) / n) ** 0.5
        if best is None or rms < best[0]:
            best = (rms, sign, offset, residual)
    _, sign, offset, residual = best

    mx = sum(xs) / n
    my = sum(ys) / n
    var = sum((x - mx) ** 2 for x in xs)
    free_slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var if var > 1e-9 else float("nan")
    return sign, offset, residual, free_slope


def solve(poses: list[tuple[list[float], dict[str, float]]], previous: dict) -> dict:
    jmap: dict[str, dict] = {}
    print(f"\n  fitted over {len(poses)} poses")
    print("  joint            sign   offset   spread  residual  slope")
    for i, name in enumerate(BODY):
        xs = [math.degrees(sim[i]) for sim, _ in poses]
        ys = [arm[name] for _, arm in poses]
        spread = max(xs) - min(xs)
        sign, offset, residual, slope = fit(xs, ys)

        note = ""
        if spread < 15.0:
            # Not enough travel to see a direction. Keep whatever was measured
            # before rather than overwriting it with a guess.
            prev = previous.get(name)
            if prev:
                sign, offset = prev["sign"], prev["offset_deg"]
                note = f"  <- only {spread:.0f} deg of travel, kept previous"
            else:
                note = f"  <- only {spread:.0f} deg of travel, sign unmeasured"
        elif residual > 3.0:
            note = "  <- poses disagree, add another pose"
        elif abs(abs(slope) - 1.0) > 0.12:
            # Compare magnitudes: an inverted joint fits slope -1, not +1.
            note = f"  <- matches run {'short' if abs(slope) < 1 else 'long'}, offset may be biased"

        print(f"  {name:<15} {sign:+d}   {offset:+7.1f}  {spread:7.1f}  {residual:7.1f}  {slope:5.2f}{note}")
        jmap[name] = {"sign": sign, "offset_deg": round(offset, 2)}

    fracs = [sim[5] / GRIPPER_RAD_MAX for sim, _ in poses]
    pcts = [arm["gripper"] for _, arm in poses]
    if max(fracs) - min(fracs) < 0.15:
        print(f"  {'gripper':<15} kept at 0..100 - aperture barely changed across the poses")
        jmap["gripper"] = previous.get("gripper", {"closed_pct": 0.0, "open_pct": 100.0})
    else:
        n = len(fracs)
        mf, mp = sum(fracs) / n, sum(pcts) / n
        var = sum((f - mf) ** 2 for f in fracs)
        slope = sum((f - mf) * (p - mp) for f, p in zip(fracs, pcts)) / var
        closed = mp - slope * mf
        opened = closed + slope
        closed, opened = max(0.0, min(100.0, closed)), max(0.0, min(100.0, opened))
        print(f"  {'gripper':<15} closed {closed:5.1f}%   open {opened:5.1f}%")
        jmap["gripper"] = {"closed_pct": round(closed, 1), "open_pct": round(opened, 1)}
    return jmap


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True)
    ap.add_argument("--id", default="follower_arm")
    ap.add_argument("--api", default="http://localhost:8787")
    args = ap.parse_args()

    from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig

    robot = SO101Follower(SO101FollowerConfig(port=args.port, id=args.id, use_degrees=True))
    robot.connect(calibrate=False)
    robot.bus.disable_torque()
    print("Torque is OFF - the arm is limp and safe to pose by hand.")
    print("Support it before letting go; gravity will drop it.")

    previous = json.loads(MAP_PATH.read_text()) if MAP_PATH.exists() else {}
    poses: list[tuple[list[float], dict[str, float]]] = []
    try:
        while True:
            n = len(poses) + 1
            hint = " (make it clearly different from the last)" if n > 1 else ""
            prompt = f"\n[pose {n}]{hint} Enter to capture"
            prompt += ", or d to finish: " if len(poses) >= 2 else ": "
            answer = input(prompt).strip().lower()
            if answer == "d":
                if len(poses) >= 2:
                    break
                print("  need at least two poses")
                continue
            poses.append(capture(robot, args.api, n))
        jmap = solve(poses, previous)
    finally:
        robot.disconnect()

    MAP_PATH.write_text(json.dumps(jmap, indent=2) + "\n")
    print(f"\nWrote {MAP_PATH}")
    print("Re-run the bridge with --dry-run first and check the degrees look sane.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
