/* =========================================================================
   Simulated drivers for the Pages demo: the dry-run loops of
   drivers/so101_arm.py and drivers/lekiwi_base.py, ported line for line so
   the pages see exactly the messages a dry-run bridge sends. Each is a
   `spawn` for server/arms.js or server/base.js.

   One addition: in teleop nobody is holding the simulated leader, so the
   demo moves it the way a hand would, and the follower copies it.
   ========================================================================= */
const JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"];
const BODY = JOINTS.slice(0, 5);
const GRIPPER_RAD_MAX = 1.74533;
const DEG = 180 / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const argOf = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

/* A hand moving the limp leader: slow, smooth, well inside its travel. */
function handOnLeader(t) {
  return {
    shoulder_pan: 28 * Math.sin(0.45 * t),
    shoulder_lift: -15 + 18 * Math.sin(0.6 * t + 0.4),
    elbow_flex: 25 + 22 * Math.sin(0.5 * t + 1.1),
    wrist_flex: 45 + 18 * Math.sin(0.7 * t),
    wrist_roll: 20 * Math.sin(0.35 * t),
    gripper: 50 + 40 * Math.sin(0.9 * t)
  };
}

/* spawn for createArms. loadMap(arm) returns the saved joint map or null;
   getMode() is the bridge's current mode. */
export function simArmSpawner({ loadMap, getMode }) {
  return function spawn({ args, onMessage }) {
    const port = argOf(args, "--port");
    const id = argOf(args, "--id");
    const arm = id === "leader" || args.includes("--start-relaxed") ? "leader" : "follower";
    const startRelaxed = args.includes("--start-relaxed");
    const emit = (msg) => queueMicrotask(() => onMessage(msg));

    const saved = loadMap(arm);
    const map = {
      ...Object.fromEntries(BODY.map((j) => [j, { sign: 1, offset_deg: 0 }])),
      gripper: { closed_pct: 0, open_pct: 100 }
    };
    for (const [k, v] of Object.entries(saved || {})) if (map[k] && typeof v === "object") Object.assign(map[k], v);

    // The dry run's travel: the shape of a real calibration.
    const limits = { ...Object.fromEntries(BODY.map((j) => [j, [-90, 90]])), gripper: [0, 100] };
    const command = { ...Object.fromEntries(BODY.map((j) => [j, 0])), gripper: 50 };

    const toArm = (rad) => {
      const out = {};
      BODY.forEach((j, i) => {
        out[j] = clamp(map[j].sign * rad[i] * DEG + map[j].offset_deg, ...limits[j]);
      });
      const g = map.gripper;
      const frac = clamp(rad[5] / GRIPPER_RAD_MAX, 0, 1);
      out.gripper = clamp(g.closed_pct + frac * (g.open_pct - g.closed_pct), ...limits.gripper);
      return out;
    };
    const clampArm = (pos) => Object.fromEntries(JOINTS.map((j) => [j, clamp(pos[j] ?? command[j], ...limits[j])]));

    emit({ type: "log", msg: "dry run: no hardware touched" });
    emit({
      type: "ready", dry_run: true, port, id, relaxed: startRelaxed, identity_map: !saved,
      limits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v])),
      present: { ...command }
    });

    const HZ = 50, dt = 1 / HZ, WATCHDOG = 0.75, MAX_DEG_S = 60, GRIP_PCT_S = 200;
    let latest = null, latestDeg = null, lastRx = 0, mode = startRelaxed ? "relax" : "hold";
    let telemetry = false, presentDt = 1 / 8, relaxed = startRelaxed;
    let lastStatus = 0, lastPresent = 0;
    const t0 = performance.now();

    const timer = setInterval(() => {
      const now = performance.now() / 1000;
      const age = lastRx ? now - lastRx : 1e9;
      if (mode === "relax") {
        if (!relaxed) { relaxed = true; emit({ type: "log", msg: "torque off" }); }
        // Nobody holds a simulated leader; in teleop, move it as a hand would.
        if (arm === "leader" && getMode() === "teleop") {
          const hand = handOnLeader((performance.now() - t0) / 1000);
          for (const j of JOINTS) command[j] += (hand[j] - command[j]) * 0.08;
        }
      } else {
        if (relaxed) { relaxed = false; emit({ type: "log", msg: "torque on, holding present position" }); }
        // A stale stream holds the last pose rather than chasing it.
        let goal = null;
        if (age < WATCHDOG) {
          if (latest) goal = toArm(latest);
          else if (latestDeg) goal = clampArm(latestDeg);
        }
        if (goal) {
          for (const j of JOINTS) {
            const step = (j === "gripper" ? GRIP_PCT_S : MAX_DEG_S) * dt;
            command[j] += clamp(goal[j] - command[j], -step, step);
          }
        }
      }
      if (telemetry && now - lastPresent >= presentDt - 1e-3) {
        lastPresent = Math.max(lastPresent + presentDt, now - presentDt);
        emit({ type: "present", dry_run: true, pos: Object.fromEntries(JOINTS.map((j) => [j, Math.round(command[j] * 100) / 100])) });
      }
      if (now - lastStatus >= 0.25) {
        lastStatus = now;
        emit({
          type: "status", mode, relaxed, stale: age > WATCHDOG,
          command: Object.fromEntries(JOINTS.map((j) => [j, Math.round(command[j] * 10) / 10]))
        });
      }
    }, 1000 / HZ);

    function send(msg) {
      const now = performance.now() / 1000;
      if (msg.cmd === "joints" && Array.isArray(msg.j) && msg.j.length === 6 && msg.j.every(Number.isFinite)) {
        latest = msg.j.slice(); latestDeg = null; lastRx = now; mode = "run";
      } else if (msg.cmd === "joints_deg" && msg.pos && JOINTS.every((j) => Number.isFinite(msg.pos[j]))) {
        latestDeg = { ...msg.pos }; latest = null; lastRx = now; mode = "run";
      } else if (msg.cmd === "relax" || msg.cmd === "hold") {
        mode = msg.cmd;
      } else if (msg.cmd === "telemetry") {
        telemetry = !!msg.on;
        if (Number.isFinite(msg.hz) && msg.hz > 0 && msg.hz <= 60) presentDt = 1 / msg.hz;
      }
      return true;
    }

    return { proc: { kill: () => clearInterval(timer), stdin: { end() {}, destroyed: false } }, send };
  };
}

/* spawn for createBase: the LeKiwi base's dry run. */
export function simBaseSpawner() {
  return function spawn({ onMessage }) {
    const emit = (msg) => queueMicrotask(() => onMessage(msg));
    const A = { hz: 30, maxLin: 0.25, maxRot: 60, linAccel: 0.5, linDecel: 1.5, rotAccel: 180, rotDecel: 540, watchdog: 0.4, odomHz: 20 };
    const WHEEL_RADIUS = 0.05, BASE_RADIUS = 0.125;
    const WHEEL_ANGLES = [240, 0, 120].map((a) => (a - 90) * Math.PI / 180);
    const toWheels = (vx, vy, wzDeg) => WHEEL_ANGLES.map((a) => Math.cos(a) * vx + Math.sin(a) * vy + BASE_RADIUS * wzDeg * Math.PI / 180);
    const ramp = (cur, goal, accel, decel, dt) => {
      const slowing = Math.abs(goal) < Math.abs(cur) || goal * cur < 0;
      const step = (slowing ? decel : accel) * dt;
      return cur + clamp(goal - cur, -step, step);
    };

    emit({ type: "log", msg: "dry run: no hardware touched" });
    emit({ type: "ready", dry_run: true, port: "sim", max_lin: A.maxLin, max_rot: A.maxRot, watchdog: A.watchdog });

    let goal = [0, 0, 0], lastDrive = 0, lastOdom = 0, staleReported = false;
    const cmd = [0, 0, 0], pose = [0, 0, 0], wheels = [0, 0, 0];
    const dt = 1 / A.hz;

    const timer = setInterval(() => {
      const now = performance.now() / 1000;
      const stale = (lastDrive ? now - lastDrive : 1e9) > A.watchdog;
      let g = goal;
      if (stale) {
        g = [0, 0, 0];
        if (!staleReported && cmd.some((c) => Math.abs(c) > 1e-6)) emit({ type: "log", msg: "drive stream went stale - stopping" });
        staleReported = true;
      } else staleReported = false;
      cmd[0] = ramp(cmd[0], g[0] * A.maxLin, A.linAccel, A.linDecel, dt);
      cmd[1] = ramp(cmd[1], g[1] * A.maxLin, A.linAccel, A.linDecel, dt);
      cmd[2] = ramp(cmd[2], g[2] * A.maxRot, A.rotAccel, A.rotDecel, dt);
      const meas = cmd.slice();
      const th = pose[2] * Math.PI / 180;
      pose[0] += (meas[0] * Math.cos(th) - meas[1] * Math.sin(th)) * dt;
      pose[1] += (meas[0] * Math.sin(th) + meas[1] * Math.cos(th)) * dt;
      pose[2] = ((pose[2] + meas[2] * dt + 180) % 360 + 360) % 360 - 180;
      toWheels(...meas).forEach((v, i) => { wheels[i] = (wheels[i] + (v / WHEEL_RADIUS) * dt) % (2 * Math.PI); });
      if (now - lastOdom >= 1 / A.odomHz) {
        lastOdom = now;
        const r = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
        emit({ type: "odom", pose: [r(pose[0], 4), r(pose[1], 4), r(pose[2], 2)], vel: meas.map((v) => r(v, 3)), cmd: cmd.map((v) => r(v, 3)), wheels: wheels.map((v) => r(v, 3)), stale });
      }
    }, 1000 / A.hz);

    function send(msg) {
      if (msg.cmd === "drive") {
        const v = [msg.x, msg.y, msg.w].map(Number);
        if (v.every(Number.isFinite)) { goal = v.map((x) => clamp(x, -1, 1)); lastDrive = performance.now() / 1000; }
      } else if (msg.cmd === "stop") {
        goal = [0, 0, 0];
        lastDrive = performance.now() / 1000;
      } else if (msg.cmd === "reset_odom") {
        pose[0] = pose[1] = pose[2] = 0;
      }
      return true;
    }

    return { proc: { kill: () => clearInterval(timer), stdin: { end() {}, destroyed: false } }, send };
  };
}
