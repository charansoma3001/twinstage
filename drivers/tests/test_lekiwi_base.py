"""The base driver's wheel maths and its dry-run safety behaviour."""

import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import lekiwi_base
from lekiwi_base import MAX_RAW, body_to_wheel_raw

DRIVER = Path(lekiwi_base.__file__)


def test_pure_rotation_turns_every_wheel_the_same_way():
    raw = body_to_wheel_raw(0.0, 0.0, 60.0)
    values = list(raw.values())
    assert all(v > 0 for v in values) and max(values) - min(values) <= 1


def test_wheel_speed_is_capped():
    raw = body_to_wheel_raw(5.0, 5.0, 720.0)
    assert max(abs(v) for v in raw.values()) <= MAX_RAW


def test_stops_on_its_own_when_drives_stop():
    p = subprocess.Popen([sys.executable, "-u", str(DRIVER), "--dry-run"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    msgs = []

    def read():
        for line in p.stdout:
            try:
                msgs.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    threading.Thread(target=read, daemon=True).start()
    try:
        for _ in range(15):
            p.stdin.write(json.dumps({"cmd": "drive", "x": 1.0, "y": 0, "w": 0}) + "\n")
            p.stdin.flush()
            time.sleep(0.03)
        moving = [m for m in msgs if m.get("type") == "odom" and m["vel"][0] > 0]
        assert moving, msgs[-3:]
        # Keep the link alive but send no drive: past the 0.4 s watchdog plus
        # the deceleration ramp, the base must be stopped.
        for _ in range(15):
            p.stdin.write(json.dumps({"cmd": "ping"}) + "\n")
            p.stdin.flush()
            time.sleep(0.1)
        last = [m for m in msgs if m.get("type") == "odom"][-1]
        assert abs(last["vel"][0]) < 1e-6
    finally:
        p.stdin.close()
        p.wait(timeout=3)
