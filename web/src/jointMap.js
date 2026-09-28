import { CONFIG } from "./config.js";
import { BODY_JOINTS } from "./so101.js";

/* =========================================================================
   The sim <-> arm joint map.

   Stored the way the driver applies it (drivers/so101_arm.py), sim -> arm:
     arm_deg     = sign * sim_deg + offset_deg          (per body joint)
     gripper_pct = closed_pct + frac * (open_pct - closed_pct)
   The browser needs the inverse, to pose the twin from what an arm reports.
   ========================================================================= */
const DEG = Math.PI / 180;
const GRIPPER_RAD_MAX = CONFIG.limits[5].max;

export const identityMap = () => ({
  ...Object.fromEntries(BODY_JOINTS.map((j) => [j, { sign: 1, offset_deg: 0 }])),
  gripper: { closed_pct: 0, open_pct: 100 }
});

/* Reported LeRobot units ({joint: deg, gripper: pct}) -> six URDF radians.
   sign is +/-1, so it is its own inverse. */
export function armToUrdf(map, reported) {
  const m = map || identityMap();
  const q = BODY_JOINTS.map((j) => {
    const e = m[j] || { sign: 1, offset_deg: 0 };
    return e.sign * ((reported[j] ?? 0) - e.offset_deg) * DEG;
  });
  const g = m.gripper || { closed_pct: 0, open_pct: 100 };
  const span = g.open_pct - g.closed_pct;
  const frac = span === 0 ? 0 : ((reported.gripper ?? 0) - g.closed_pct) / span;
  q.push(Math.max(0, Math.min(1, frac)) * GRIPPER_RAD_MAX);
  return q;
}

/* The driver's direction, six URDF radians -> LeRobot units. The bridge does
   this in Python; it lives here so the two directions are tested together. */
export function urdfToArm(map, q) {
  const m = map || identityMap();
  const out = {};
  BODY_JOINTS.forEach((j, i) => {
    const e = m[j] || { sign: 1, offset_deg: 0 };
    out[j] = e.sign * (q[i] / DEG) + e.offset_deg;
  });
  const g = m.gripper || { closed_pct: 0, open_pct: 100 };
  const frac = Math.max(0, Math.min(1, q[5] / GRIPPER_RAD_MAX));
  out.gripper = g.closed_pct + frac * (g.open_pct - g.closed_pct);
  return out;
}
