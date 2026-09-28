import { describe, it, expect } from "vitest";
import { isValidJointMap } from "../hub.js";

const good = () => ({
  shoulder_pan: { sign: 1, offset_deg: 0 }, shoulder_lift: { sign: -1, offset_deg: 4 },
  elbow_flex: { sign: 1, offset_deg: 7 }, wrist_flex: { sign: 1, offset_deg: -8 },
  wrist_roll: { sign: 1, offset_deg: 0 }
});

describe("joint map validation", () => {
  it("accepts a complete map", () => expect(isValidJointMap(good())).toBe(true));
  it("rejects a sign other than +/-1", () => {
    const m = good(); m.elbow_flex.sign = 2;
    expect(isValidJointMap(m)).toBe(false);
  });
  it("rejects a missing joint or a non-finite offset", () => {
    const a = good(); delete a.wrist_roll;
    const b = good(); b.wrist_flex.offset_deg = NaN;
    expect(isValidJointMap(a)).toBe(false);
    expect(isValidJointMap(b)).toBe(false);
    expect(isValidJointMap(null)).toBe(false);
  });
});
