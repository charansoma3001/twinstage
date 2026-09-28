// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { keepOut, inwardLimit } from "../src/stage/keepout.js";
import { primitiveTarget, mirror, mirrorStation, STATION_A, STATION_B, PICK_CYCLE_S } from "../src/primitives.js";
import { loadMeshBody } from "./meshBody.js";

/* keepOut promises that no part of the moving arm, open jaw included,
   reaches past the inward limit. Held to the full meshes (not the hull
   keepOut uses), for both arms, over targets well past the midline across
   the hands range (z 12-34 cm, any height), every approach pitch, wrist
   roll and jaw opening, several rig layouts, and the mirrored primitives. */
const D = Math.PI / 180;
const TOL = 0.5e-3;   // metres: the hull's accuracy, see so101Body.test.js

let mesh;
beforeAll(async () => { mesh = await loadMeshBody(); }, 60000);

const reach = (q, left) => mesh.reach(q, left ? -1 : 1).reach;

const LAYOUTS = [[30, 12], [20, 8], [40, 20], [26, 10]];   // [spacing cm, gap cm]

describe("keep-out between two arms", () => {
  it("computes the inward limit from spacing and gap", () => {
    expect(inwardLimit(30, 12)).toBeCloseTo(0.09, 9);
    expect(inwardLimit(10, 20)).toBe(0);
  });

  it("leaves a target alone when the whole arm already fits", () => {
    // The right arm has the other arm at +X; this target is out at -X.
    const t = { x: -0.1, y: 0.15, z: 0.25, pitch: -90 * D, roll: 0, gripper: 0 };
    const r = keepOut(t, false, 0.09);
    expect(r.moved).toBe(false);
    expect(r.cart).toBe(t);
  });

  it("moves only side to side, and only away from the other arm", () => {
    const t = { x: 0.2, y: 0.03, z: 0.13, pitch: -90 * D, roll: 0, gripper: 1 };
    const r = keepOut(t, false, 0.09);
    expect(r.moved).toBe(true);
    expect(r.cart.x).toBeLessThan(0.09);
    expect([r.cart.y, r.cart.z, r.cart.gripper]).toEqual([t.y, t.z, t.gripper]);
  });

  for (const [spacing, gap] of LAYOUTS) {
    it(`keeps the whole arm inside the limit over the hands range (${spacing} cm, gap ${gap} cm)`, () => {
      const lim = inwardLimit(spacing, gap);
      let worst = -Infinity;
      for (const left of [true, false])
        for (let x = -0.3; x <= 0.3001; x += 0.06)
          for (let y = 0; y <= 0.3401; y += 0.085)
            for (let z = 0.12; z <= 0.3401; z += 0.055)
              for (const pitch of [-90, -45, 0])
                for (const roll of [0, 1.2, -1.2])
                  for (const gripper of [0, 1]) {
                    const r = keepOut({ x, y, z, pitch: pitch * D, roll, gripper }, left, lim);
                    // Blocked sends nothing (tested below); everything sent must fit.
                    if (r.blocked) continue;
                    worst = Math.max(worst, reach(r.q, left) - lim);
                  }
      expect(worst).toBeLessThanOrEqual(TOL);
    }, 120000);
  }

  it("keeps the mirrored primitives inside the limit", () => {
    const lim = inwardLimit(30, 12);
    const mirrored = {
      pickAt: (k) => mirrorStation(k % 2 ? STATION_B : STATION_A),
      placeAt: (k) => mirrorStation(k % 2 ? STATION_A : STATION_B)
    };
    for (const name of ["pickAndPlace", "pinchTest", "waveScan"]) {
      for (const left of [true, false]) {
        for (let t = 0; t < 2 * PICK_CYCLE_S; t += 0.1) {
          let target = primitiveTarget(name, t, left ? mirrored : undefined);
          if (left) target = mirror(target);
          const r = keepOut(target, left, lim);
          expect(r.blocked).toBe(false);
          expect(reach(r.q, left)).toBeLessThanOrEqual(lim + TOL);
        }
      }
    }
  }, 120000);

  it("never blocks what hands mode sends (top-down, roll 0) on these layouts", () => {
    for (const [spacing, gap] of LAYOUTS) {
      const lim = inwardLimit(spacing, gap);
      for (const left of [true, false])
        for (let x = -0.3; x <= 0.3001; x += 0.03)
          for (let y = 0; y <= 0.3401; y += 0.034)
            for (let z = 0.12; z <= 0.3401; z += 0.022)
              for (const gripper of [0, 0.5, 1]) {
                expect(keepOut({ x, y, z, pitch: -90 * D, roll: 0, gripper }, left, lim).blocked).toBe(false);
              }
    }
  }, 120000);

  it("returns no pose at all when nothing fits, so nothing is sent", () => {
    const r = keepOut({ x: 0, y: 0.03, z: 0.13, pitch: -90 * D, roll: 0, gripper: 1 }, false, -0.2);
    expect(r).toEqual({ cart: null, q: null, moved: true, blocked: true });
  });
});
