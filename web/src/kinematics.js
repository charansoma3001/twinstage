import { CONFIG, ARM } from "./config.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const LIM = CONFIG.limits;

/* =========================================================================
   SO-101 INVERSE KINEMATICS

   Solves shoulder_pan and the planar 3R chain (shoulder_lift, elbow_flex,
   wrist_flex) for a tool-point position plus an approach pitch.

   Scene frame: +X right, +Y up, +Z forward. The pan axis is vertical through
   the origin, and the URDF's pan axis points along scene -Y, so a target to
   the right (+X) needs a negative shoulder_pan.

   The requested pitch is a preference, not a constraint. Holding it exactly
   often drives wrist_flex past its +/-95 degree limit near the table, and
   clamping the joint there throws the tool ~100 mm off target -- the gripper
   sinks through the table while the target marker stays put. Position wins:
   if the requested pitch is infeasible we give up approach angle to keep the
   tool where it was asked to be.
   ========================================================================= */
const PITCH_STEP = 2 * Math.PI / 180;
const PITCH_SEARCH = Math.PI;

function solveAtPitch(x, y, z, pitch, elbowUp) {
  // Into the arm plane: rho radially out from the pan axis, zeta up.
  const rho = Math.hypot(x, z) - ARM.shoulderRho;
  const zeta = y - ARM.shoulderZeta;

  // Back off along the approach direction to the wrist_flex position.
  const wRho = rho - ARM.L3 * Math.cos(pitch);
  const wZeta = zeta - ARM.L3 * Math.sin(pitch);

  const reach = Math.hypot(wRho, wZeta);
  const inReach = reach <= ARM.L1 + ARM.L2 && reach >= Math.abs(ARM.L1 - ARM.L2);
  const D = clamp(reach, Math.abs(ARM.L1 - ARM.L2) + 1e-4, ARM.L1 + ARM.L2 - 1e-4);

  const cosLift = clamp((ARM.L1 * ARM.L1 + D * D - ARM.L2 * ARM.L2) / (2 * ARM.L1 * D), -1, 1);
  const bend = Math.acos(cosLift);
  const a1 = Math.atan2(wZeta, wRho) + (elbowUp ? bend : -bend);
  const a2 = Math.atan2(wZeta - ARM.L1 * Math.sin(a1), wRho - ARM.L1 * Math.cos(a1));

  // Convert absolute in-plane link headings into joint values. Each joint is
  // relative to the one before it, and a positive value lowers the heading.
  const lift = ARM.ZERO.link1 - a1;
  const elbow = (ARM.ZERO.link2 - a2) - lift;
  const wristFlex = (ARM.ZERO.link3 - pitch) - lift - elbow;

  const feasible = inReach &&
    lift >= LIM[1].min && lift <= LIM[1].max &&
    elbow >= LIM[2].min && elbow <= LIM[2].max &&
    wristFlex >= LIM[3].min && wristFlex <= LIM[3].max;

  return { lift, elbow, wristFlex, pitch, feasible, inReach };
}

export function solveSO101IK(target) {
  const { x, y, z } = target;

  let best = solveAtPitch(x, y, z, target.pitch, true);
  if (!best.feasible) {
    const down = solveAtPitch(x, y, z, target.pitch, false);
    best = down.feasible ? down : best;
  }
  if (!best.feasible) {
    // Widen the search outwards from the requested pitch, trying both elbow
    // branches, and take the first pose that fits inside every joint limit.
    outer:
    for (let d = PITCH_STEP; d <= PITCH_SEARCH; d += PITCH_STEP) {
      for (const p of [target.pitch + d, target.pitch - d]) {
        for (const up of [true, false]) {
          const s = solveAtPitch(x, y, z, p, up);
          if (s.feasible) { best = s; break outer; }
        }
      }
    }
  }

  return {
    shoulder_pan: clamp(-Math.atan2(x, z), LIM[0].min, LIM[0].max),
    shoulder_lift: clamp(best.lift, LIM[1].min, LIM[1].max),
    elbow_flex: clamp(best.elbow, LIM[2].min, LIM[2].max),
    wrist_flex: clamp(best.wristFlex, LIM[3].min, LIM[3].max),
    gripper: clamp(target.gripper, 0, 1) * LIM[5].max,
    // What the arm could actually hold, vs what was asked for.
    pitchUsed: best.pitch,
    // True when no approach angle at all puts the tool on the target.
    unreachable: !best.feasible
  };
}
