// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { loadMeshBody } from "./meshBody.js";
import { ikJoints } from "../src/stage/keepout.js";
import { setJoints } from "../src/so101.js";
import { primitiveTarget, blockState, mirror, mirrorStation, STATION_A, STATION_B, PICK_CYCLE_S } from "../src/primitives.js";
import { makeBlock, placeBlock } from "../src/stage/twin.js";

/* Pick & place on the twin, frame by frame on the real meshes: the block
   starts on A, the jaws close on it rather than above it, it is put down on
   B, and the next cycle picks it up from there. */
let body;
const CYCLES = 6;   // long enough to see the block drift, if it does
beforeAll(async () => { body = await loadMeshBody(); }, 60000);

function run(left) {
  const { robot, toolPoint } = body;
  let mount = toolPoint;
  while (mount.parent) mount = mount.parent;
  const holder = new THREE.Group();
  holder.add(mount);
  const a = { holder, toolPoint, block: makeBlock(), held: null };
  holder.add(a.block);

  const stations = [STATION_A, STATION_B].map((s) => (left ? mirrorStation(s) : s));
  const tool = new THREE.Vector3(), blk = new THREE.Vector3();
  const grips = [], drops = [];
  let f = null, was = null;
  for (let frame = 0; frame < CYCLES * PICK_CYCLE_S * 60; frame++) {
    const t = frame / 60;
    let target = primitiveTarget("pickAndPlace", t);
    if (left) target = mirror(target);
    // The stage's smoothing (drive.js filterTarget), one step per frame.
    if (!f) f = { ...target };
    for (const k of ["x", "y", "z", "pitch", "roll", "gripper"]) f[k] += 0.35 * (target[k] - f[k]);
    setJoints(robot, ikJoints(f));
    const how = blockState(t, stations);
    placeBlock(a, how);
    holder.updateMatrixWorld(true);
    tool.setFromMatrixPosition(toolPoint.matrixWorld);
    blk.setFromMatrixPosition(a.block.matrixWorld);
    if (how === "held" && was !== "held") {
      // Along the reach, how far the block's centre is past the tool point.
      const dir = new THREE.Vector2(tool.x, tool.z).normalize();
      grips.push({ t, ahead: (blk.x - tool.x) * dir.x + (blk.z - tool.z) * dir.y, side: (blk.z - tool.z) * dir.x - (blk.x - tool.x) * dir.y, y: blk.y });
    }
    if (how === "released" && was === "held") drops.push({ t, x: blk.x, y: blk.y, z: blk.z });
    was = how;
  }
  return { grips, drops, stations };
}

describe.each([["right", false], ["left", true]])("pick & place block, %s arm", (_n, left) => {
  it("is gripped between the jaws, put down on B, and picked up again, cycle after cycle", () => {
    const { grips, drops, stations } = run(left);
    expect(grips.length).toBe(CYCLES);
    expect(drops.length).toBe(CYCLES);
    for (const g of grips) {
      // Between the jaws: the fixed jaw is 6 mm behind the tool point and the
      // 22 mm block's centre 5 mm past it, give or take a few mm per station.
      expect(Math.abs(g.ahead - 0.005)).toBeLessThan(0.005);
      expect(Math.abs(g.side)).toBeLessThan(0.004);
      expect(g.y).toBeCloseTo(0.02, 2);   // standing on the table
    }
    // The first drop lands on B, a few mm past the station along the reach.
    const b = stations[1];
    expect(Math.hypot(drops[0].x - b.x, drops[0].z - b.z)).toBeLessThan(0.01);
    expect(drops[0].y).toBeCloseTo(0.02, 3);
  });
});
