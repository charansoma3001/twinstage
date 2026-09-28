/* =========================================================================
   EGOCENTRIC TASK PRIMITIVES

   Cartesian targets over time, in one arm's own frame (+X toward the
   operator's left, +Z forward, +Y up). The studio runs them on its one arm;
   the stage runs them on either arm or both, mirroring the arm on the
   operator's left so the pair moves symmetrically.
   ========================================================================= */
const D = Math.PI / 180;

// Pick & place stations, for the arm on the operator's right. The arm on the
// left uses their mirror image. A is near and outward, B far and inward.
export const STATION_A = { x: -0.13, z: 0.16 };
export const STATION_B = { x: 0.13, z: 0.30 };
export const PICK_CYCLE_S = 7.5;
// Tool height at the block when picking or placing it.
export const PICK_HEIGHT = 0.03;

// Joint-space rest, in URDF radians: folded, jaws nearly closed.
export const REST_JOINTS = [0, -1.2, 1.3, 0.8, 0, 0.3];

/* pickAt(k) / placeAt(k) give the {x, z} of cycle k's pick and drop-off. */
function pickAndPlace(t, { pickAt, placeAt }) {
  const k = Math.floor(t / PICK_CYCLE_S);
  const cycle = t % PICK_CYCLE_S;
  const pick = pickAt(k);
  const place = placeAt(k);
  const down = -90 * D;
  if (cycle < 1.8) return { x: pick.x, y: 0.14, z: pick.z, pitch: down, roll: 0, gripper: 0.9 };   // approach
  if (cycle < 2.8) return { x: pick.x, y: PICK_HEIGHT, z: pick.z, pitch: down, roll: 0, gripper: 0.9 };   // descend
  if (cycle < 3.8) return { x: pick.x, y: PICK_HEIGHT, z: pick.z, pitch: down, roll: 0, gripper: 0.1 };   // close
  if (cycle < 5.2) return { x: place.x, y: 0.22, z: place.z, pitch: down, roll: 0, gripper: 0.1 }; // lift + transit
  if (cycle < 6.2) return { x: place.x, y: PICK_HEIGHT, z: place.z, pitch: down, roll: 0, gripper: 0.1 }; // descend, holding
  if (cycle < 6.7) return { x: place.x, y: PICK_HEIGHT, z: place.z, pitch: down, roll: 0, gripper: 0.9 }; // release at the table
  return { x: 0.0, y: 0.22, z: 0.24, pitch: down, roll: 0, gripper: 0.8 };                         // retreat
}

function pinch(t) {
  return {
    x: 0.0, y: 0.22, z: 0.24,
    pitch: -20 * D,
    roll: Math.sin(t * 1.5) * 0.35,
    gripper: (Math.sin(t * 3.2) + 1.0) / 2.0
  };
}

function wave(t) {
  return {
    x: Math.sin(t * 1.8) * 0.15,
    y: 0.22 + Math.cos(t * 2.4) * 0.06,
    z: 0.24 + Math.sin(t * 1.2) * 0.04,
    pitch: (Math.sin(t * 2.0) * 25 - 15) * D,
    roll: Math.cos(t * 1.8) * 0.5,
    gripper: 0.65
  };
}

/* Block shuttles A -> B, then B -> A, and so on: after any whole number of
   cycles it sits on one of the two taped stations. */
export const shuttle = {
  pickAt: (k) => (k % 2 === 0 ? STATION_A : STATION_B),
  placeAt: (k) => (k % 2 === 0 ? STATION_B : STATION_A)
};

export function primitiveTarget(name, t, opts = shuttle) {
  if (name === "pickAndPlace") return pickAndPlace(t, opts);
  if (name === "pinchTest") return pinch(t);
  if (name === "waveScan") return wave(t);
  return null;
}

/* The operator's-left arm's copy: side-to-side and roll change sign. */
export function mirror(target) {
  return { ...target, x: -target.x, roll: -target.roll };
}

export function mirrorStation(s) {
  return { x: -s.x, z: s.z };
}
