import { describe, it, expect } from "vitest";
import { armToUrdf, urdfToArm, identityMap } from "../src/jointMap.js";
import { CONFIG } from "../src/config.js";

const measured = {
  shoulder_pan: { sign: 1, offset_deg: -1.74 },
  shoulder_lift: { sign: -1, offset_deg: -4 },
  elbow_flex: { sign: 1, offset_deg: 7 },
  wrist_flex: { sign: -1, offset_deg: 8 },
  wrist_roll: { sign: 1, offset_deg: -0.57 },
  gripper: { closed_pct: 98.3, open_pct: 2 }     // reversed: direction lives in the order
};

describe("joint map", () => {
  it("inverts the driver's mapping across the joint range", () => {
    for (const map of [identityMap(), measured]) {
      for (let k = 0; k <= 10; k++) {
        const q = CONFIG.limits.map((l) => l.min + ((l.max - l.min) * k) / 10);
        const back = armToUrdf(map, urdfToArm(map, q));
        back.forEach((v, i) => expect(v).toBeCloseTo(q[i], 9));
      }
    }
  });

  it("clamps a gripper reading outside the calibrated span", () => {
    expect(armToUrdf(identityMap(), { gripper: 150 })[5]).toBeCloseTo(CONFIG.limits[5].max, 9);
    expect(armToUrdf(identityMap(), { gripper: -20 })[5]).toBe(0);
  });

  it("treats a missing map as identity", () => {
    expect(armToUrdf(null, { shoulder_pan: 90 })[0]).toBeCloseTo(Math.PI / 2, 9);
  });
});
