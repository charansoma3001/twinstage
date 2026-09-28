// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { bodyReach } from "../src/so101Body.js";
import { loadMeshBody } from "./meshBody.js";
import { CONFIG } from "../src/config.js";

/* The hull stands in for the meshes in every keep-out check, so it must
   never report less reach than the meshes have. Random poses over the whole
   joint range, both directions. */
let mesh;
beforeAll(async () => { mesh = await loadMeshBody(); }, 60000);

function* poses(n, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < n; k++) yield CONFIG.limits.map((l) => l.min + (l.max - l.min) * rnd());
}

describe("SO-101 body hull", () => {
  it("matches the full meshes to within 0.5 mm, and never under-reports", () => {
    let worstUnder = 0, worstOver = 0;
    for (const q of poses(300)) {
      for (const sign of [1, -1]) {
        const truth = mesh.reach(q, sign).reach;
        const hull = bodyReach(q, sign);
        worstUnder = Math.max(worstUnder, truth - hull);
        worstOver = Math.max(worstOver, hull - truth);
      }
    }
    expect(worstUnder).toBeLessThan(0.5e-3);
    // Hull points are mesh vertices rounded to 0.1 mm; measured 0.08 both ways.
    expect(worstOver).toBeLessThan(0.2e-3);
  }, 60000);
});
