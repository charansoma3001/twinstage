import { solveSO101IK } from "../kinematics.js";

/* =========================================================================
   Keep-out between two side-by-side arms.

   Coordinates are one arm's own frame: +X toward the operator's left, so the
   arm on the operator's left has the other arm at its -X, the right arm at
   its +X. `lim` is how far toward the other arm (metres from this arm's pan
   axis) it may reach: half the base spacing, less half the minimum gap.

   Only the gripper target is clamped. Every link lies in the pan plane, and
   over the whole hands workspace, at every approach pitch the IK can relax
   to, and along every mirrored primitive, no joint reached further inward
   than the gripper (worst overshoot 0.00 mm, 30 cm spacing, 12 cm gap).
   ========================================================================= */
export function ikJoints(cart) {
  const q = solveSO101IK(cart);
  return [q.shoulder_pan, q.shoulder_lift, q.elbow_flex, q.wrist_flex, cart.roll, q.gripper];
}

export function keepOut(t, left, lim) {
  const x = left ? Math.max(t.x, -lim) : Math.min(t.x, lim);
  return x === t.x ? t : { ...t, x };
}
