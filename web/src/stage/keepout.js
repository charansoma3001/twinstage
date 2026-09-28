import { solveSO101IK } from "../kinematics.js";
import { bodyReach } from "../so101Body.js";

/* =========================================================================
   Keep-out between two side-by-side arms.

   Coordinates are one arm's own frame: +X toward the operator's left, so the
   arm on the operator's left has the other arm at its -X, the right arm at
   its +X. `lim` is how far toward the other arm (metres from this arm's pan
   axis) any part of it may reach: half the base spacing, less half the
   minimum gap. Two arms that both respect it stay minGap apart.

   Clamping the tool point is not enough: the wrist and gripper housings sit
   off the pan plane, and the open moving jaw near the base reaches ~67 mm
   past the tool point (URDF meshes, 30 cm spacing). keepOut therefore
   solves the pose, measures the whole moving body (so101Body.js), and
   moves the target away from the other arm until the body fits.
   ========================================================================= */
const SEARCH_M = 0.3;      // furthest a target is moved outward
const COARSE_STEPS = 12;   // 25 mm apart
const ITERATIONS = 10;     // then bisection: 25 mm / 2^10 = 0.02 mm

export function ikJoints(cart) {
  const q = solveSO101IK(cart);
  return [q.shoulder_pan, q.shoulder_lift, q.elbow_flex, q.wrist_flex, cart.roll, q.gripper];
}

/* How far toward the other arm (metres) either arm may reach: half the base
   spacing, less half the minimum gap. */
export function inwardLimit(armSpacingCm, minGapCm) {
  return Math.max(0, armSpacingCm / 2 - minGapCm / 2) / 100;
}

/* The target as sent and the joints that reach it. `moved` says the target
   had to give way. `blocked` says no outward shift up to SEARCH_M clears
   the limit (the layout is too tight for this pose); cart and q are then
   null and the caller must not send anything, so the driver's watchdog
   holds the arm at its last pose, which did fit. */
export function keepOut(t, left, lim) {
  const sign = left ? -1 : 1;                 // +1: the other arm is at +X
  // The tool point first: nothing is gained searching from past the limit.
  const start = sign * t.x > lim ? { ...t, x: sign * lim } : t;
  const at = (s) => {
    const cart = s === 0 ? start : { ...start, x: start.x - sign * s };
    const q = ikJoints(cart);
    return { cart, q, fits: bodyReach(q, sign) <= lim };
  };

  const first = at(0);
  if (first.fits) return { cart: first.cart, q: first.q, moved: start !== t, blocked: false };

  // Coarse scan outward for the first shift that fits, then bisect between it
  // and the one before. `hi` always fits, so what is returned always fits,
  // whether or not the body's reach is monotonic in the target's x.
  let lo = 0, hi = null, best = null;
  for (let k = 1; k <= COARSE_STEPS; k++) {
    const s = (SEARCH_M * k) / COARSE_STEPS;
    const probe = at(s);
    if (probe.fits) { hi = s; best = probe; break; }
    lo = s;
  }
  if (!best) return { cart: null, q: null, moved: true, blocked: true };
  for (let i = 0; i < ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const probe = at(mid);
    if (probe.fits) { hi = mid; best = probe; } else lo = mid;
  }
  return { cart: best.cart, q: best.q, moved: true, blocked: false };
}
