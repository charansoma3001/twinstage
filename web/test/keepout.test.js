// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { keepOut, ikJoints, inwardLimit } from "../src/stage/keepout.js";
import { primitiveTarget, mirror, mirrorStation, STATION_A, STATION_B, PICK_CYCLE_S } from "../src/primitives.js";
import { parseURDF } from "../src/urdf.js";
import { mountSO101, setJoints } from "../src/so101.js";

/* keepOut clamps the tool point, and only the tool point, to the inward
   limit. These tests hold it to that on the real joint tree, for both arms,
   over targets well past the midline (the hands range: z 12-34 cm, any
   height), every approach pitch, several rig layouts and the mirrored
   primitives.

   The arm's body is NOT held to the limit. Measured on the URDF meshes at
   30 cm spacing / 12 cm gap: the wrist and gripper housings reach up to
   ~38 mm past it, and the moving jaw, fully open near the base, ~67 mm --
   past the 60 mm to the midline. The todo at the bottom is that guarantee. */
const URDF = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/urdf/SO101/so101_new_calib.urdf");
const D = Math.PI / 180;
const TOL = 1e-3;   // metres: IK lands within 0.2 mm, see kinematics.test.js

let robot, toolPoint;
const v = new THREE.Vector3();

beforeAll(() => {
  robot = parseURDF(readFileSync(URDF, "utf8"));
  ({ toolPoint } = mountSO101(robot));
});

/* How far the tool point gets toward the other arm, from this arm's pan axis. */
function inwardReach(q, left) {
  setJoints(robot, q);
  robot.root.updateMatrixWorld(true);
  const x = toolPoint.getWorldPosition(v).x;
  return left ? -x : x;
}

const LAYOUTS = [[30, 12], [20, 8], [40, 20], [24, 16]];   // [spacing cm, gap cm]

describe("keep-out between two arms", () => {
  it("computes the inward limit from spacing and gap", () => {
    expect(inwardLimit(30, 12)).toBeCloseTo(0.09, 9);
    expect(inwardLimit(10, 20)).toBe(0);
  });

  it("clamps only the side facing the other arm", () => {
    const t = { x: -0.2, y: 0.1, z: 0.2, pitch: 0, roll: 0, gripper: 0 };
    expect(keepOut(t, true, 0.09).x).toBeCloseTo(-0.09, 9);
    expect(keepOut(t, false, 0.09)).toBe(t);
    expect(keepOut({ ...t, x: 0.2 }, false, 0.09).x).toBeCloseTo(0.09, 9);
  });

  for (const [spacing, gap] of LAYOUTS) {
    it(`keeps the tool point inside the limit over the hands range (${spacing} cm, gap ${gap} cm)`, () => {
      const lim = inwardLimit(spacing, gap);
      for (const left of [true, false]) {
        for (let x = -0.3; x <= 0.3001; x += 0.03)
          for (let y = 0; y <= 0.3401; y += 0.04)
              for (let z = 0.12; z <= 0.3401; z += 0.02)
              for (const pitch of [-90, -60, -30, 0, 30]) {
                const cart = keepOut({ x, y, z, pitch: pitch * D, roll: 0, gripper: 0.5 }, left, lim);
                expect(inwardReach(ikJoints(cart), left)).toBeLessThanOrEqual(lim + TOL);
              }
      }
    });
  }

  it("keeps the mirrored primitives' tool point inside the limit", () => {
    const lim = inwardLimit(30, 12);
    for (const name of ["pickAndPlace", "pinchTest", "waveScan"]) {
      for (const left of [true, false]) {
        const opts = left
          ? { pickAt: (k) => mirrorStation(k % 2 ? STATION_B : STATION_A), placeAt: (k) => mirrorStation(k % 2 ? STATION_A : STATION_B) }
          : undefined;
        for (let t = 0; t < 2 * PICK_CYCLE_S; t += 0.05) {
          let target = primitiveTarget(name, t, opts);
          if (left) target = mirror(target);
          const cart = keepOut(target, left, lim);
          expect(inwardReach(ikJoints(cart), left)).toBeLessThanOrEqual(lim + TOL);
        }
      }
    }
  });

  it.todo("keeps the physical arm, open jaw included, inside the limit");
});
