"""The arm driver's safety behaviour, in dry run (no LeRobot, no hardware).

Unit tests pin the sim -> arm mapping and the travel clamp; the process
tests run the real driver loop and check the slew limit and the watchdog
from what it reports.
"""

import json
import math
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

import so101_arm
from so101_arm import JOINTS, Mapper

DRIVER = Path(so101_arm.__file__)
IDENTITY = json.loads(json.dumps(so101_arm.DEFAULT_MAP))


def test_mapping_applies_sign_and_offset():
    jmap = json.loads(json.dumps(IDENTITY))
    jmap["shoulder_lift"] = {"sign": -1, "offset_deg": 4.0}
    out = Mapper(jmap, {}).to_arm([0.0, math.radians(30), 0.0, 0.0, 0.0, 0.0])
    assert out["shoulder_lift"] == pytest.approx(-30 + 4)


def test_mapping_matches_the_browser_inverse():
    # Same vectors as web/test/jointMap.test.js walks: the browser's armToUrdf
    # is this function's inverse, so the two must agree on the formula.
    jmap = {
        "shoulder_pan": {"sign": 1, "offset_deg": -1.74},
        "shoulder_lift": {"sign": -1, "offset_deg": -4},
        "elbow_flex": {"sign": 1, "offset_deg": 7},
        "wrist_flex": {"sign": -1, "offset_deg": 8},
        "wrist_roll": {"sign": 1, "offset_deg": -0.57},
        "gripper": {"closed_pct": 98.3, "open_pct": 2},
    }
    q = [0.5, -0.4, 0.3, -0.2, 0.1, so101_arm.GRIPPER_RAD_MAX / 2]
    out = Mapper(jmap, {}).to_arm(q)
    for i, j in enumerate(JOINTS[:5]):
        assert out[j] == pytest.approx(jmap[j]["sign"] * math.degrees(q[i]) + jmap[j]["offset_deg"])
    assert out["gripper"] == pytest.approx(98.3 + 0.5 * (2 - 98.3))


def test_every_goal_is_clamped_to_calibrated_travel():
    limits = {j: (-20.0, 20.0) for j in JOINTS[:5]} | {"gripper": (2.0, 98.0)}
    m = Mapper(IDENTITY, limits)
    out = m.to_arm([3.0, -3.0, 3.0, -3.0, 3.0, 99.0])
    assert all(-20 <= out[j] <= 20 for j in JOINTS[:5])
    assert out["gripper"] == 98.0
    held = m.clamp_arm({"shoulder_pan": 500.0}, {j: 0.0 for j in JOINTS})
    assert held["shoulder_pan"] == 20.0 and held["elbow_flex"] == 0.0


class Driver:
    """The real driver in dry run, fed on stdin, read on stdout."""

    def __init__(self, *extra):
        self.p = subprocess.Popen(
            [sys.executable, "-u", str(DRIVER), "--port", "dry", "--dry-run",
             "--map", "/nonexistent/joint_map.json", *extra],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        self.msgs: list[tuple[float, dict]] = []
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.p.stdout:
            try:
                self.msgs.append((time.monotonic(), json.loads(line)))
            except json.JSONDecodeError:
                pass

    def send(self, **msg):
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()

    def wait_for(self, pred, timeout=3.0):
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            for _, m in self.msgs:
                if pred(m):
                    return m
            time.sleep(0.02)
        raise AssertionError(f"not seen in {timeout}s; got {[m for _, m in self.msgs][-5:]}")

    def presents(self, since=0.0):
        return [(t, m["pos"]) for t, m in self.msgs if m.get("type") == "present" and t >= since]

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=3)


@pytest.fixture
def driver():
    d = Driver("--dry-present", json.dumps({j: 0.0 for j in JOINTS}))
    d.wait_for(lambda m: m.get("type") == "ready")
    yield d
    d.close()


def test_reports_identity_map_when_none_is_measured(driver):
    ready = driver.wait_for(lambda m: m.get("type") == "ready")
    assert ready["identity_map"] is True and ready["dry_run"] is True


def test_slew_limit_ramps_instead_of_jumping(driver):
    driver.send(cmd="telemetry", on=True, hz=50)
    t0 = time.monotonic()
    # Ask for 90 degrees of pan at once, and keep asking (the watchdog wants a stream).
    for _ in range(40):
        driver.send(cmd="joints", j=[math.radians(90), 0, 0, 0, 0, 0])
        time.sleep(0.02)
    samples = driver.presents(since=t0)
    assert len(samples) > 20
    pans = [p["shoulder_pan"] for _, p in samples]
    # 60 deg/s default: 0.8 s of streaming reaches ~48, nowhere near 90.
    assert max(pans) < 60
    assert max(pans) > 30
    for (ta, a), (tb, b) in zip(samples, samples[1:]):
        assert abs(b["shoulder_pan"] - a["shoulder_pan"]) <= 60 * (tb - ta) + 2.5


def test_watchdog_holds_when_the_stream_stops(driver):
    driver.send(cmd="telemetry", on=True, hz=50)
    for _ in range(10):
        driver.send(cmd="joints", j=[math.radians(90), 0, 0, 0, 0, 0])
        time.sleep(0.02)
    time.sleep(1.0)   # past the 0.75 s watchdog
    t_stale = time.monotonic()
    time.sleep(0.5)
    pans = [p["shoulder_pan"] for _, p in driver.presents(since=t_stale)]
    assert pans and max(pans) - min(pans) < 1e-6
    driver.wait_for(lambda m: m.get("type") == "status" and m.get("stale") is True)


def test_ignores_malformed_commands(driver):
    driver.send(cmd="joints", j=[1, 2, 3])            # wrong length
    driver.send(cmd="joints", j=["a"] * 6)            # not numbers
    driver.p.stdin.write("not json\n")
    driver.p.stdin.flush()
    status = driver.wait_for(lambda m: m.get("type") == "status")
    assert status["mode"] == "hold"
    assert driver.p.poll() is None
