#!/usr/bin/env python
"""SO-101 arm driver for the overhead retargeting studio.

Speaks newline-delimited JSON on stdin/stdout so the Node bridge can own its
lifecycle -- no second websocket port, no extra Python dependency, and the arm
process dies with the bridge that spawned it.

    stdin   {"cmd": "joints", "j": [6 radians, URDF convention]}
            {"cmd": "joints_deg", "pos": {joint: LeRobot units}}   teleop: another
                                 arm's calibrated reading, used as-is
            {"cmd": "relax"}     torque off, arm goes limp
            {"cmd": "hold"}      torque on at the present position
            {"cmd": "telemetry", "on": bool, "hz": float}
    stdout  {"type": "ready"|"status"|"present"|"error"|"log", ...}

Both command forms go through the same travel clamp, slew limit and watchdog.
The same script drives the leader arm too: --calibration-dir points it at the
leader's teleoperator calibration and --map at its own joint map.

Sim joints arrive in the URDF's radians. The real arm speaks LeRobot's
calibrated degrees, whose zero is the *midpoint of the range you swept during
calibration* -- not the URDF zero pose. The two therefore differ by a constant
per joint, and some joints turn the opposite way. joint_map.json holds that
sign and offset; drivers/jog.py measures it. Until it is measured the map is
identity, which is why --dry-run is the default.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import threading
import time
from pathlib import Path

JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
BODY = JOINTS[:5]

# The sim's gripper joint travel, straight off the URDF limit in config.js.
GRIPPER_RAD_MAX = 1.74533

DEFAULT_MAP_PATH = Path(__file__).with_name("joint_map.json")
MAP_PATH = DEFAULT_MAP_PATH

DEFAULT_MAP = {
    **{j: {"sign": 1, "offset_deg": 0.0} for j in BODY},
    "gripper": {"closed_pct": 0.0, "open_pct": 100.0},
}


def emit(**msg) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def load_map() -> dict:
    if not MAP_PATH.exists():
        return json.loads(json.dumps(DEFAULT_MAP))
    saved = json.loads(MAP_PATH.read_text())
    merged = json.loads(json.dumps(DEFAULT_MAP))
    for name, entry in saved.items():
        if name in merged and isinstance(entry, dict):
            merged[name].update(entry)
    return merged


class Mapper:
    """Sim radians -> LeRobot normalized units, and the safety clamp."""

    def __init__(self, jmap: dict, limits: dict[str, tuple[float, float]]):
        self.map = jmap
        self.limits = limits

    def to_arm(self, radians: list[float]) -> dict[str, float]:
        out: dict[str, float] = {}
        for i, name in enumerate(BODY):
            m = self.map[name]
            deg = m["sign"] * math.degrees(radians[i]) + m["offset_deg"]
            lo, hi = self.limits.get(name, (-180.0, 180.0))
            out[name] = min(hi, max(lo, deg))

        g = self.map["gripper"]
        frac = min(1.0, max(0.0, radians[5] / GRIPPER_RAD_MAX))
        # closed_pct/open_pct also carry the direction: swap them and the jaw
        # opens the other way, which is how an inverted gripper gets fixed.
        pct = g["closed_pct"] + frac * (g["open_pct"] - g["closed_pct"])
        lo, hi = self.limits.get("gripper", (0.0, 100.0))
        out["gripper"] = min(hi, max(lo, pct))
        return out

    def clamp_arm(self, pos: dict[str, float], fallback: dict[str, float]) -> dict[str, float]:
        """A goal already in LeRobot units: only the travel clamp applies."""
        out: dict[str, float] = {}
        for name in JOINTS:
            v = pos.get(name, fallback[name])
            lo, hi = self.limits.get(name, (0.0, 100.0) if name == "gripper" else (-180.0, 180.0))
            out[name] = min(hi, max(lo, float(v)))
        return out


def calibrated_limits(robot, margin_deg: float, margin_pct: float) -> dict[str, tuple[float, float]]:
    """Per-joint travel the calibration actually recorded, held off the ends.

    LeRobot's DEGREES mode centres zero on the midpoint of the swept range, so
    the reachable span is +/- half that range; RANGE_0_100 spans the sweep. The
    margin keeps commands off the hard stops the calibration found.
    """
    limits: dict[str, tuple[float, float]] = {}
    for name, cal in robot.bus.calibration.items():
        span_ticks = cal.range_max - cal.range_min
        if name == "gripper":
            limits[name] = (margin_pct, 100.0 - margin_pct)
        else:
            half_deg = (span_ticks / 2.0) * 360.0 / 4095.0
            usable = max(0.0, half_deg - margin_deg)
            limits[name] = (-usable, usable)
    return limits


class StdinReader(threading.Thread):
    """Keeps only the newest command; a backlog of stale poses is worse than
    dropping them, because the arm would chase them all in order."""

    def __init__(self):
        super().__init__(daemon=True)
        self.lock = threading.Lock()
        self.latest: list[float] | None = None
        self.latest_deg: dict[str, float] | None = None
        self.last_rx = 0.0
        self.mode = "hold"
        self.telemetry = False
        self.telemetry_hz: float | None = None
        self.telemetry_asked = False
        self.closed = False

    def run(self):
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            cmd = msg.get("cmd")
            if cmd == "joints":
                j = msg.get("j")
                if isinstance(j, list) and len(j) == 6 and all(isinstance(v, (int, float)) for v in j):
                    with self.lock:
                        self.latest = [float(v) for v in j]
                        self.latest_deg = None
                        self.last_rx = time.monotonic()
                        self.mode = "run"
            elif cmd == "joints_deg":
                pos = msg.get("pos")
                if isinstance(pos, dict) and all(
                    isinstance(pos.get(n), (int, float)) and math.isfinite(pos[n]) for n in JOINTS
                ):
                    with self.lock:
                        self.latest_deg = {n: float(pos[n]) for n in JOINTS}
                        self.latest = None
                        self.last_rx = time.monotonic()
                        self.mode = "run"
            elif cmd in ("relax", "hold"):
                with self.lock:
                    self.mode = cmd
            elif cmd == "telemetry":
                self.telemetry_asked = True
                # Reading present position costs a bus round trip per joint, so
                # it stays off unless something is actually watching.
                hz = msg.get("hz")
                with self.lock:
                    self.telemetry = bool(msg.get("on"))
                    if isinstance(hz, (int, float)) and 0 < hz <= 60:
                        self.telemetry_hz = float(hz)
        self.closed = True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", required=True, help="serial device, e.g. /dev/tty.usbmodemXXXXXXXX")
    ap.add_argument("--id", default="follower", help="calibration name under ~/.cache/huggingface/lerobot")
    ap.add_argument("--hz", type=float, default=50.0)
    ap.add_argument("--max-deg-per-s", type=float, default=60.0,
                    help="slew limit per joint; also what makes the first move a ramp rather than a jump")
    ap.add_argument("--gripper-pct-per-s", type=float, default=200.0)
    ap.add_argument("--margin-deg", type=float, default=3.0, help="stay this far inside the calibrated travel")
    ap.add_argument("--margin-pct", type=float, default=2.0)
    ap.add_argument("--max-relative-target", type=float, default=8.0,
                    help="LeRobot's own per-step clamp, in normalized units; 0 disables it")
    ap.add_argument("--watchdog", type=float, default=0.75, help="seconds without a command before the arm holds")
    ap.add_argument("--bus-error-s", type=float, default=0.5,
                    help="seconds of back-to-back bus errors before the driver gives up and exits")
    ap.add_argument("--present-hz", type=float, default=8.0, help="rate for present-position telemetry when enabled")
    ap.add_argument("--dry-run", action="store_true", help="compute and print commands, touch no hardware")
    ap.add_argument("--calibration-dir", default=None,
                    help="LeRobot calibration directory; the leader's lives under teleoperators/so_leader")
    ap.add_argument("--map", default=None, help="joint map JSON (default drivers/joint_map.json)")
    ap.add_argument("--start-relaxed", action="store_true",
                    help="torque off straight after connecting: a leader must be limp to be moved by hand")
    ap.add_argument("--dry-present", default=None,
                    help="dry run only: JSON of the simulated starting pose, in LeRobot units")
    args = ap.parse_args()

    global MAP_PATH
    if args.map:
        MAP_PATH = Path(args.map)
    jmap = load_map()
    mapped_default = not MAP_PATH.exists()

    robot = None
    limits: dict[str, tuple[float, float]] = {}
    present: dict[str, float] = {}

    if args.dry_run:
        # Same shape as a real arm's calibrated travel, so the numbers printed
        # in dry run are clamped exactly the way the live ones will be.
        limits = {**{j: (-90.0, 90.0) for j in BODY}, "gripper": (0.0, 100.0)}
        present = {**{j: 0.0 for j in BODY}, "gripper": 50.0}
        if args.dry_present:
            present.update({k: float(v) for k, v in json.loads(args.dry_present).items() if k in JOINTS})
        emit(type="log", msg="dry run: no hardware touched")
    else:
        try:
            from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
        except ImportError as exc:
            emit(type="error", msg=f"lerobot import failed: {exc}")
            return 2
        cfg = SO101FollowerConfig(
            port=args.port,
            id=args.id,
            use_degrees=True,
            max_relative_target=args.max_relative_target or None,
            calibration_dir=Path(args.calibration_dir).expanduser() if args.calibration_dir else None,
        )
        robot = SO101Follower(cfg)
        # The first writes to a freshly-opened USB serial adapter drop packets
        # often enough to matter, and LeRobot's torque-enable does not retry:
        # a single lost status packet fails the whole connect on whichever
        # servo it lands on. Retrying the connect costs nothing and turns a
        # dead start into a half-second delay.
        for attempt in range(1, 4):
            try:
                robot.connect(calibrate=False)
                if attempt > 1:
                    emit(type="log", msg=f"connected on attempt {attempt}")
                break
            except Exception as exc:  # noqa: BLE001 - surface whatever the bus says
                try:
                    robot.bus.disconnect()
                except Exception:  # noqa: BLE001 - it may never have opened
                    pass
                if attempt == 3:
                    emit(type="error", msg=f"connect failed after {attempt} attempts: {exc}")
                    return 3
                emit(type="log", msg=f"connect attempt {attempt} failed, retrying: {exc}")
                time.sleep(0.6)
        if not robot.calibration:
            emit(type="error", msg=f"no calibration for id '{args.id}' in {robot.calibration_dir}")
            robot.disconnect()
            return 4
        limits = calibrated_limits(robot, args.margin_deg, args.margin_pct)
        # configure() re-enables torque at the present pose. A leader has to
        # be limp from the first instant or it fights the hand holding it.
        # Both steps are bus round trips, so they get the same tolerance for a
        # dropped packet as the loop does.
        def retry(what, fn, tries=10):
            for attempt in range(1, tries + 1):
                try:
                    return fn()
                except ConnectionError as exc:
                    if attempt == tries:
                        raise
                    emit(type="log", msg=f"{what} failed (attempt {attempt}), retrying: {exc}")
                    time.sleep(0.05)
        try:
            if args.start_relaxed:
                retry("torque off", robot.bus.disable_torque)
            obs = retry("first read", robot.get_observation)
        except ConnectionError as exc:
            emit(type="error", msg=f"bus lost during start-up: {exc}")
            try:
                robot.disconnect()
            except Exception:  # noqa: BLE001 - the bus is why we are here
                pass
            return 5
        present = {j: float(obs[f"{j}.pos"]) for j in JOINTS}

    mapper = Mapper(jmap, limits)
    emit(
        type="ready",
        dry_run=args.dry_run,
        port=args.port,
        id=args.id,
        relaxed=args.start_relaxed,
        identity_map=mapped_default,
        limits={k: [round(v[0], 1), round(v[1], 1)] for k, v in limits.items()},
        present={k: round(v, 1) for k, v in present.items()},
    )
    if mapped_default:
        emit(type="log", msg="joint_map.json missing - using an identity map. Run drivers/jog.py first.")

    reader = StdinReader()
    if args.start_relaxed:
        reader.mode = "relax"
    reader.start()

    # The commanded pose starts where the arm already is, so the first frame
    # from the studio is slewed towards from the real position rather than
    # snapped to from an assumed one.
    command = dict(present)
    dt = 1.0 / args.hz
    next_tick = time.monotonic()
    last_status = 0.0
    last_present = 0.0
    present_dt = 1.0 / max(1e-3, args.present_hz)
    # Already limp when --start-relaxed; the flag keeps the loop from
    # disabling torque a second time, and says re-enabling needs a hold.
    relaxed = args.start_relaxed

    # A dropped status packet is routine on a busy Feetech bus ("There is no
    # status packet!"): LeRobot reads every servo back before each write, so
    # the arm does 50 read-backs a second and one of them occasionally goes
    # missing. One miss must not kill the driver; a run of them means the arm
    # really is gone, and then exiting (and being restarted) is right.
    bus_errors = 0
    max_bus_errors = max(1, int(args.bus_error_s * args.hz))

    def bus_ok() -> None:
        nonlocal bus_errors
        if bus_errors:
            emit(type="log", msg=f"bus recovered after {bus_errors} missed packet(s)")
        bus_errors = 0

    def bus_failed(what: str, exc: Exception) -> None:
        nonlocal bus_errors
        bus_errors += 1
        if bus_errors == 1 or bus_errors % 10 == 0:
            emit(type="log", msg=f"{what} failed ({bus_errors} in a row): {exc}")
        if bus_errors >= max_bus_errors:
            raise ConnectionError(f"{bus_errors} bus errors in a row, last: {exc}")

    # Loop timing, reported every few seconds: how much of each tick the work
    # takes, and how much of that is the bus. Measured, so a latency change
    # can be checked against a number instead of a feeling.
    loop_ms: list[float] = []
    bus_ms: list[float] = []
    overruns = 0
    errors_total = 0
    last_timing = time.monotonic()

    def pct(xs: list[float], q: float) -> float:
        return round(sorted(xs)[min(len(xs) - 1, int(q * len(xs)))], 2) if xs else 0.0

    exit_code = 0
    try:
        while not reader.closed:
            now = time.monotonic()
            tick_start = time.perf_counter()
            bus_t = 0.0
            with reader.lock:
                target_rad = reader.latest
                target_deg = reader.latest_deg
                mode = reader.mode
                telemetry = reader.telemetry
                if reader.telemetry_hz:
                    present_dt = 1.0 / reader.telemetry_hz
                age = now - reader.last_rx if reader.last_rx else 1e9

            if mode == "relax":
                if not relaxed:
                    try:
                        if robot is not None:
                            robot.bus.disable_torque()
                        relaxed = True
                        emit(type="log", msg="torque off")
                        bus_ok()
                    except ConnectionError as exc:
                        bus_failed("torque off", exc)   # stays un-relaxed; retried next tick
            else:
                if relaxed:
                    try:
                        if robot is not None:
                            robot.bus.enable_torque()
                            obs = robot.get_observation()
                            command = {j: float(obs[f"{j}.pos"]) for j in JOINTS}
                        relaxed = False
                        emit(type="log", msg="torque on, holding present position")
                        bus_ok()
                    except ConnectionError as exc:
                        bus_failed("torque on", exc)

                # A stale stream holds the last pose rather than continuing to
                # chase it: a dropped websocket must not leave the arm moving.
                goal = None
                if age < args.watchdog:
                    if target_rad is not None:
                        goal = mapper.to_arm(target_rad)
                    elif target_deg is not None:
                        goal = mapper.clamp_arm(target_deg, command)
                if goal is not None:
                    for name in JOINTS:
                        rate = args.gripper_pct_per_s if name == "gripper" else args.max_deg_per_s
                        step = rate * dt
                        delta = goal[name] - command[name]
                        command[name] += max(-step, min(step, delta))

                if robot is not None and not relaxed:
                    b0 = time.perf_counter()
                    try:
                        robot.send_action({f"{j}.pos": command[j] for j in JOINTS})
                        bus_ok()
                    except ConnectionError as exc:
                        # The goal is unchanged, so the next tick simply sends it again.
                        errors_total += 1
                        bus_failed("write", exc)
                    bus_t += time.perf_counter() - b0

            # Where the arm actually is, which is what the studio's offset
            # tuning compares its render against, and what teleop copies onto
            # the follower. A dry run reports its simulated pose, marked so.
            # On a fixed schedule, not "a full period since the last one": ticks
            # land a hair early, and the old test skipped every other one, so
            # 50 Hz came out at 30 and 30 Hz at 25.
            if telemetry and now - last_present >= present_dt - 1e-3:
                last_present = max(last_present + present_dt, now - present_dt)
                if robot is None:
                    emit(type="present", dry_run=True, pos={j: round(command[j], 2) for j in JOINTS})
                else:
                    b0 = time.perf_counter()
                    try:
                        obs = robot.get_observation()
                        emit(type="present", pos={j: round(float(obs[f"{j}.pos"]), 2) for j in JOINTS})
                        bus_ok()
                    except ConnectionError as exc:
                        errors_total += 1
                        bus_failed("present read", exc)
                    bus_t += time.perf_counter() - b0

            if now - last_status >= 0.25:
                last_status = now
                emit(type="status", mode=mode, relaxed=relaxed, stale=age > args.watchdog,
                     command={k: round(v, 1) for k, v in command.items()})

            work = (time.perf_counter() - tick_start) * 1000
            loop_ms.append(work)
            if bus_t:
                bus_ms.append(bus_t * 1000)
            if work > dt * 1000:
                overruns += 1
            if now - last_timing >= 5.0:
                last_timing = now
                emit(type="timing", budget_ms=round(dt * 1000, 1),
                     loop_p50=pct(loop_ms, 0.5), loop_p95=pct(loop_ms, 0.95),
                     bus_p50=pct(bus_ms, 0.5), bus_p95=pct(bus_ms, 0.95),
                     overruns=overruns, bus_errors=errors_total)
                loop_ms.clear()
                bus_ms.clear()
                overruns = 0

            next_tick += dt
            sleep = next_tick - time.monotonic()
            if sleep > 0:
                time.sleep(sleep)
            else:
                next_tick = time.monotonic()
    except KeyboardInterrupt:
        pass
    except ConnectionError as exc:
        emit(type="error", msg=f"bus lost: {exc}")
        exit_code = 5
    finally:
        if robot is not None:
            # disable_torque_on_disconnect defaults True, so the arm goes limp
            # here. It is already at its last commanded pose, not mid-transit.
            try:
                robot.disconnect()
                emit(type="log", msg="disconnected")
            except Exception as exc:  # noqa: BLE001 - the bus may be why we are here
                emit(type="log", msg=f"disconnect failed: {exc}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
