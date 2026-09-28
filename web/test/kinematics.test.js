// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { CONFIG } from "../src/config.js";
import { solveSO101IK } from "../src/kinematics.js";
import { parseURDF } from "../src/urdf.js";
import { mountSO101, setJoints } from "../src/so101.js";

/* The IK is closed-form over constants read off the URDF by hand. These
   tests close the loop against the URDF itself: solve, pose the real joint
   tree, and measure where the tool point lands. They sweep the whole
   workspace and every approach pitch rather than a few poses, because the
   failures that matter (wrist_flex at its limit, the pitch fallback) only
   show up near the edges. */
const URDF = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/urdf/SO101/so101_new_calib.urdf");
const D = Math.PI / 180;
const W = CONFIG.workspace;
const LIM = CONFIG.limits;

let robot, toolPoint;
const at = new THREE.Vector3();

beforeAll(() => {
  robot = parseURDF(readFileSync(URDF, "utf8"));
  ({ toolPoint } = mountSO101(robot));
});

function reach(q, roll = 0) {
  setJoints(robot, [q.shoulder_pan, q.shoulder_lift, q.elbow_flex, q.wrist_flex, roll, q.gripper]);
  robot.root.updateMatrixWorld(true);
  return toolPoint.getWorldPosition(at);
}

function* grid(n) {
  const lerp = (a, b, i) => a + ((b - a) * i) / (n - 1);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        yield { x: lerp(W.xMin, W.xMax, i), y: lerp(W.yMin, W.yMax, j), z: lerp(W.zMin, W.zMax, k) };
}

const PITCHES = [-90, -60, -30, 0, 30].map((p) => p * D);

describe("solveSO101IK against the URDF", () => {
  it("puts the tool point on every reachable workspace target", () => {
    let worst = 0, solved = 0, total = 0;
    for (const p of grid(9)) {
      for (const pitch of PITCHES) {
        total++;
        const q = solveSO101IK({ ...p, pitch, gripper: 0.5 });
        if (q.unreachable) continue;
        solved++;
        worst = Math.max(worst, reach(q).distanceTo(new THREE.Vector3(p.x, p.y, p.z)));
      }
    }
    expect(worst).toBeLessThan(0.5e-3);        // metres; 0.2 mm measured
    // The workspace box is meant to be reachable; the fallback should find
    // a pitch for nearly all of it.
    expect(solved / total).toBeGreaterThan(0.95);
  });

  it("keeps every joint inside its URDF limit", () => {
    for (const p of grid(7)) {
      for (const pitch of PITCHES) {
        const q = solveSO101IK({ ...p, pitch, gripper: 1 });
        ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex"].forEach((j, i) => {
          expect(q[j]).toBeGreaterThanOrEqual(LIM[i].min);
          expect(q[j]).toBeLessThanOrEqual(LIM[i].max);
        });
        expect(q.gripper).toBeLessThanOrEqual(LIM[5].max);
      }
    }
  });

  it("holds the requested pitch when it is feasible", () => {
    const q = solveSO101IK({ x: 0, y: 0.1, z: 0.22, pitch: -45 * D, gripper: 0 });
    expect(q.unreachable).toBe(false);
    expect(q.pitchUsed).toBeCloseTo(-45 * D, 6);
  });

  it("ignores wrist roll: the tool point sits on the roll axis", () => {
    const q = solveSO101IK({ x: 0.1, y: 0.05, z: 0.25, pitch: -90 * D, gripper: 0 });
    const a = reach(q, 0).clone();
    const b = reach(q, 2.5).clone();
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });

  it("flags a target out of reach instead of pretending", () => {
    const q = solveSO101IK({ x: 0, y: 0.1, z: 0.9, pitch: 0, gripper: 0 });
    expect(q.unreachable).toBe(true);
  });
});
