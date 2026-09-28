#!/usr/bin/env python
"""LeKiwi base driver: the three omniwheels and nothing else.

Runs on the base's Pi. The Node bridge starts it over ssh and speaks the same
newline JSON as so101_arm.py, so the wheels stop when the bridge, the ssh link
or the browser goes away.

    stdin   {"cmd": "drive", "x": f, "y": f, "w": f}   fractions of the speed cap, -1..1
                                                      x forward, y left, w counter-clockwise
            {"cmd": "stop"}          goal to zero now
            {"cmd": "reset_odom"}    odometry back to the origin
            {"cmd": "ping"}          keep-alive from the bridge; moves nothing
    stdout  {"type": "ready"|"odom"|"error"|"log", ...}

The motor bus holds only IDs 7-9. The arm on the same bus (IDs 1-6) is never
addressed, so nothing here can move it or change its torque. lerobot's own
LeKiwi host cannot be used for base-only driving: its send_action always writes
arm goal positions, and an empty write raises before the wheels are reached.

Stdlib only outside the live path, so --dry-run works on any machine.
"""

from __future__ import annotations

import argparse
import json
import math
import signal
import sys
import threading
import time

WHEELS = ["base_left_wheel", "base_back_wheel", "base_right_wheel"]
WHEEL_IDS = {"base_left_wheel": 7, "base_back_wheel": 8, "base_right_wheel": 9}

# lerobot's LeKiwi kinematics (lekiwi.py _body_to_wheel_raw), reproduced so the
# wheel commands match what the stock driver would send for the same velocity.
WHEEL_RADIUS = 0.05
BASE_RADIUS = 0.125
WHEEL_ANGLES = [math.radians(a - 90) for a in (240, 0, 120)]
STEPS_PER_DEG = 4096.0 / 360.0
MAX_RAW = 3000


def emit(**msg) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def body_to_wheel_linear(vx: float, vy: float, wz_deg: float) -> list[float]:
    wz = math.radians(wz_deg)
    return [math.cos(a) * vx + math.sin(a) * vy + BASE_RADIUS * wz for a in WHEEL_ANGLES]


def body_to_wheel_raw(vx: float, vy: float, wz_deg: float) -> dict[str, int]:
    degps = [math.degrees(v / WHEEL_RADIUS) for v in body_to_wheel_linear(vx, vy, wz_deg)]
    peak = max(abs(d) * STEPS_PER_DEG for d in degps)
    if peak > MAX_RAW:
        degps = [d * MAX_RAW / peak for d in degps]
    return {name: int(round(d * STEPS_PER_DEG)) for name, d in zip(WHEELS, degps)}


def solve3(m: list[list[float]], b: list[float]) -> list[float]:
    """Cramer's rule; the wheel matrix is fixed and well conditioned."""
    def det(a):
        return (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
                - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    d = det(m)
    out = []
    for col in range(3):
        mc = [row[:] for row in m]
        for r in range(3):
            mc[r][col] = b[r]
        out.append(det(mc) / d)
    return out


WHEEL_MATRIX = [[math.cos(a), math.sin(a), BASE_RADIUS] for a in WHEEL_ANGLES]


def wheel_raw_to_body(raw: dict[str, int]) -> tuple[float, float, float]:
    linear = [math.radians(raw[n] / STEPS_PER_DEG) * WHEEL_RADIUS for n in WHEELS]
    vx, vy, wz = solve3(WHEEL_MATRIX, linear)
    return vx, vy, math.degrees(wz)


def ramp(current: float, goal: float, accel: float, decel: float, dt: float) -> float:
    """Slew toward goal. Slowing down (toward zero) is allowed to be faster than
    speeding up, so a released key stops the base promptly without a jerk on
    every start."""
    slowing = abs(goal) < abs(current) or goal * current < 0
    step = (decel if slowing else accel) * dt
    return current + max(-step, min(step, goal - current))


class StdinReader(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.lock = threading.Lock()
        self.goal = (0.0, 0.0, 0.0)
        self.last_drive = 0.0
        self.last_line = time.monotonic()
        self.reset = False
        self.closed = False

    def run(self):
        for line in sys.stdin:
            now = time.monotonic()
            with self.lock:
                self.last_line = now
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            cmd = msg.get("cmd")
            if cmd == "drive":
                vals = [msg.get(k, 0.0) for k in ("x", "y", "w")]
                if all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals):
                    with self.lock:
                        self.goal = tuple(max(-1.0, min(1.0, float(v))) for v in vals)
                        self.last_drive = now
            elif cmd == "stop":
                with self.lock:
                    self.goal = (0.0, 0.0, 0.0)
                    self.last_drive = now
            elif cmd == "reset_odom":
                with self.lock:
                    self.reset = True
        self.closed = True


def open_bus(port: str):
    from lerobot.motors import Motor, MotorNormMode
    from lerobot.motors.feetech import FeetechMotorsBus, OperatingMode

    bus = FeetechMotorsBus(
        port=port,
        motors={n: Motor(WHEEL_IDS[n], "sts3215", MotorNormMode.RANGE_M100_100) for n in WHEELS},
    )
    # A freshly opened USB serial adapter drops the first packets often enough
    # to fail a handshake; the arm driver retries for the same reason.
    for attempt in range(1, 4):
        try:
            bus.connect()
            break
        except Exception as exc:  # noqa: BLE001 - surface whatever the bus says
            try:
                bus.disconnect(disable_torque=False)
            except Exception:  # noqa: BLE001 - it may never have opened
                pass
            if attempt == 3:
                raise
            emit(type="log", msg=f"connect attempt {attempt} failed, retrying: {exc}")
            time.sleep(0.6)

    bus.disable_torque()
    bus.configure_motors()
    for name in WHEELS:
        bus.write("Operating_Mode", name, OperatingMode.VELOCITY.value)
    bus.enable_torque()
    bus.sync_write("Goal_Velocity", dict.fromkeys(WHEELS, 0), num_retry=5)
    return bus


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="/dev/ttyACM0")
    ap.add_argument("--hz", type=float, default=30.0)
    ap.add_argument("--max-lin", type=float, default=0.25, help="m/s at full stick")
    ap.add_argument("--max-rot", type=float, default=60.0, help="deg/s at full stick")
    ap.add_argument("--lin-accel", type=float, default=0.5, help="m/s^2 speeding up")
    ap.add_argument("--lin-decel", type=float, default=1.5, help="m/s^2 slowing down")
    ap.add_argument("--rot-accel", type=float, default=180.0, help="deg/s^2 speeding up")
    ap.add_argument("--rot-decel", type=float, default=540.0, help="deg/s^2 slowing down")
    ap.add_argument("--watchdog", type=float, default=0.4, help="s without a drive command before the goal is zero")
    ap.add_argument("--link-timeout", type=float, default=5.0,
                    help="s without any line from the bridge before exiting, which frees the port")
    ap.add_argument("--odom-hz", type=float, default=20.0)
    ap.add_argument("--dry-run", action="store_true", help="integrate commands, touch no hardware")
    ap.add_argument("--tag", default="", help="marker so a stale instance can be found with pkill -f")
    args = ap.parse_args()

    # The servos hold their last Goal_Velocity, so a driver that dies without
    # its finally block leaves the base rolling. SIGTERM (pkill, the bridge's
    # fallback kill) and SIGHUP must run the same stop path as Ctrl-C.
    def _stop_signal(signum, _frame):
        raise KeyboardInterrupt(signal.Signals(signum).name)
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, _stop_signal)

    bus = None
    if args.dry_run:
        emit(type="log", msg="dry run: no hardware touched")
    else:
        try:
            bus = open_bus(args.port)
        except ImportError as exc:
            emit(type="error", msg=f"lerobot import failed: {exc}")
            return 2
        except Exception as exc:  # noqa: BLE001
            emit(type="error", msg=f"bus open failed on {args.port}: {exc}")
            return 3

    emit(type="ready", dry_run=args.dry_run, port=args.port,
         max_lin=args.max_lin, max_rot=args.max_rot, watchdog=args.watchdog)

    reader = StdinReader()
    reader.start()

    dt = 1.0 / args.hz
    cmd = [0.0, 0.0, 0.0]            # commanded body velocity: m/s, m/s, deg/s
    meas = (0.0, 0.0, 0.0)           # measured body velocity, same units
    pose = [0.0, 0.0, 0.0]           # odometry: x fwd m, y left m, heading deg
    wheel_angle = [0.0, 0.0, 0.0]    # rad, integrated from measured velocity
    last_odom = 0.0
    stale_reported = False
    next_tick = time.monotonic()

    try:
        while not reader.closed:
            now = time.monotonic()
            with reader.lock:
                goal = reader.goal
                age = now - reader.last_drive if reader.last_drive else 1e9
                link_age = now - reader.last_line
                if reader.reset:
                    pose = [0.0, 0.0, 0.0]
                    reader.reset = False

            if link_age > args.link_timeout:
                emit(type="log", msg=f"no line from the bridge for {link_age:.1f}s - exiting")
                break

            stale = age > args.watchdog
            if stale:
                goal = (0.0, 0.0, 0.0)
                if not stale_reported and any(abs(c) > 1e-6 for c in cmd):
                    emit(type="log", msg="drive stream went stale - stopping")
                stale_reported = True
            else:
                stale_reported = False

            target = (goal[0] * args.max_lin, goal[1] * args.max_lin, goal[2] * args.max_rot)
            cmd[0] = ramp(cmd[0], target[0], args.lin_accel, args.lin_decel, dt)
            cmd[1] = ramp(cmd[1], target[1], args.lin_accel, args.lin_decel, dt)
            cmd[2] = ramp(cmd[2], target[2], args.rot_accel, args.rot_decel, dt)

            if bus is not None:
                bus.sync_write("Goal_Velocity", body_to_wheel_raw(*cmd))
                try:
                    raw = bus.sync_read("Present_Velocity", WHEELS)
                    meas = wheel_raw_to_body({n: int(raw[n]) for n in WHEELS})
                except Exception as exc:  # noqa: BLE001 - a bad read must not stop the loop
                    emit(type="log", msg=f"velocity read failed: {exc}")
            else:
                meas = tuple(cmd)

            # Odometry from what the wheels report, not what was asked of them.
            # It drifts: omniwheels slip. The twin only needs it to look right
            # over a few seconds, not to know where the base is in the room.
            th = math.radians(pose[2])
            pose[0] += (meas[0] * math.cos(th) - meas[1] * math.sin(th)) * dt
            pose[1] += (meas[0] * math.sin(th) + meas[1] * math.cos(th)) * dt
            pose[2] = (pose[2] + meas[2] * dt + 180.0) % 360.0 - 180.0
            for i, v in enumerate(body_to_wheel_linear(*meas)):
                wheel_angle[i] = (wheel_angle[i] + v / WHEEL_RADIUS * dt) % (2 * math.pi)

            if now - last_odom >= 1.0 / args.odom_hz:
                last_odom = now
                emit(type="odom",
                     pose=[round(pose[0], 4), round(pose[1], 4), round(pose[2], 2)],
                     vel=[round(v, 3) for v in meas],
                     cmd=[round(v, 3) for v in cmd],
                     wheels=[round(a, 3) for a in wheel_angle],
                     stale=stale)

            next_tick += dt
            sleep = next_tick - time.monotonic()
            if sleep > 0:
                time.sleep(sleep)
            else:
                next_tick = time.monotonic()
    except KeyboardInterrupt:
        pass
    finally:
        if bus is not None:
            try:
                bus.sync_write("Goal_Velocity", dict.fromkeys(WHEELS, 0), num_retry=5)
            finally:
                # Wheels only: torque off lets the base be pushed by hand.
                bus.disconnect(disable_torque=True)
            emit(type="log", msg="wheels stopped, bus closed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
