import { solveSO101IK } from "../kinematics.js";

/* =========================================================================
   Keep-out between two side-by-side arms.

   Coordinates are one arm's own frame: +X toward the operator's left, so the
   arm on the operator's left has the other arm at its -X, the right arm at
   its +X. `lim` is how far toward the other arm (metres from this arm's pan
   axis) it may reach: half the base spacing, less half the minimum gap.

   Only the tool point is clamped. The body is wider than that point: on the
   URDF meshes, at 30 cm spacing and a 12 cm gap, the wrist and gripper
   housings reach up to ~38 mm further inward and the open moving jaw up to
   ~67 mm, which is past the midline. web/test/keepout.test.js measures it.
   ========================================================================= */
export function ikJoints(cart) {
  const q = solveSO101IK(cart);
  return [q.shoulder_pan, q.shoulder_lift, q.elbow_flex, q.wrist_flex, cart.roll, q.gripper];
}

export function keepOut(t, left, lim) {
  const x = left ? Math.max(t.x, -lim) : Math.min(t.x, lim);
  return x === t.x ? t : { ...t, x };
}

/* How far toward the other arm (metres) either arm may reach: half the base
   spacing, less half the minimum gripper gap. */
export function inwardLimit(armSpacingCm, minGapCm) {
  return Math.max(0, armSpacingCm / 2 - minGapCm / 2) / 100;
}
