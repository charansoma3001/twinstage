import { describe, it, expect, beforeEach, vi } from "vitest";
import { createModes, RELAX_COUNTDOWN_MS, TELEOP_HZ } from "../modes.js";

/* Fake arms: records what each driver was sent. */
function fakeArms(overrides = {}) {
  const state = {
    leader: { ready: true, relaxed: true, identityMap: false, dryRun: false },
    follower: { ready: true, relaxed: false, identityMap: false, dryRun: false }
  };
  for (const [n, s] of Object.entries(overrides)) Object.assign(state[n], s);
  const sent = [];
  return {
    names: ["follower", "leader"],
    state: (n) => state[n],
    send: (n, obj) => { sent.push([n, obj]); return true; },
    sent
  };
}

let broadcasts;
const broadcast = (m) => broadcasts.push(m);
const fakeWs = () => ({ sent: [], send(s) { this.sent.push(JSON.parse(s)); } });

beforeEach(() => {
  broadcasts = [];
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("mode guards", () => {
  it("refuses teleop unless both arms are running", () => {
    const modes = createModes({ arms: fakeArms({ leader: { ready: false } }), broadcast });
    const ws = fakeWs();
    modes.set("teleop", "", ws);
    expect(modes.current()).toBe("idle");
    expect(ws.sent[0].refused).toMatch(/both the leader and the follower/);
  });

  it("refuses hands on a live arm with no measured joint map", () => {
    const modes = createModes({ arms: fakeArms({ leader: { identityMap: true } }), broadcast });
    const ws = fakeWs();
    modes.set("hands", "", ws);
    expect(modes.current()).toBe("idle");
    expect(ws.sent[0].refused).toMatch(/no joint map for leader/);
  });

  it("allows hands on an unmapped arm in a dry run", () => {
    const modes = createModes({ arms: fakeArms({ leader: { identityMap: true, dryRun: true } }), broadcast });
    modes.set("hands");
    expect(modes.current()).toBe("hands");
  });

  it("ignores unknown modes", () => {
    const modes = createModes({ arms: fakeArms(), broadcast });
    modes.set("turbo");
    expect(modes.current()).toBe("idle");
    expect(broadcasts).toHaveLength(0);
  });
});

describe("teleop entry", () => {
  it("warns before dropping a powered leader, then relaxes it", () => {
    const arms = fakeArms({ leader: { relaxed: false } });
    const modes = createModes({ arms, broadcast });
    modes.set("teleop");
    expect(modes.current()).toBe("idle");
    expect(modes.view().pending.mode).toBe("teleop");
    expect(arms.sent.filter(([, o]) => o.cmd === "relax")).toHaveLength(0);

    vi.advanceTimersByTime(RELAX_COUNTDOWN_MS - 1);
    expect(modes.current()).toBe("idle");
    vi.advanceTimersByTime(1);
    expect(modes.current()).toBe("teleop");
    expect(arms.sent).toContainEqual(["leader", { cmd: "relax" }]);
    expect(arms.sent).toContainEqual(["leader", { cmd: "telemetry", on: true, hz: TELEOP_HZ }]);
  });

  it("cancels the countdown on freeze", () => {
    const arms = fakeArms({ leader: { relaxed: false } });
    const modes = createModes({ arms, broadcast });
    modes.set("teleop");
    modes.freeze("stop pressed");
    vi.advanceTimersByTime(RELAX_COUNTDOWN_MS * 2);
    expect(modes.current()).toBe("idle");
    expect(arms.sent.filter(([, o]) => o.cmd === "relax")).toHaveLength(0);
    expect(arms.sent).toContainEqual(["leader", { cmd: "hold" }]);
    expect(arms.sent).toContainEqual(["follower", { cmd: "hold" }]);
  });

  it("enters at once when the leader is already limp", () => {
    const modes = createModes({ arms: fakeArms(), broadcast });
    modes.set("teleop");
    expect(modes.current()).toBe("teleop");
  });

  it("forwards the leader's reading to the follower only in teleop", () => {
    const arms = fakeArms();
    const modes = createModes({ arms, broadcast });
    modes.onPresent("leader", { pos: { shoulder_pan: 3 } });
    expect(arms.sent).toHaveLength(0);
    modes.set("teleop");
    modes.onPresent("leader", { pos: { shoulder_pan: 3 } });
    expect(arms.sent.at(-1)).toEqual(["follower", { cmd: "joints_deg", pos: { shoulder_pan: 3 } }]);
  });
});

describe("joint stream gating", () => {
  it("takes the stage in hands and primitive, the settings page in manual, nobody otherwise", () => {
    const modes = createModes({ arms: fakeArms(), broadcast });
    const allowed = () => ["stage", "studio"].filter((s) => modes.allowsJointsFrom(s));
    expect(allowed()).toEqual([]);
    modes.set("hands");
    expect(allowed()).toEqual(["stage"]);
    modes.set("primitive");
    expect(allowed()).toEqual(["stage"]);
    modes.set("manual");
    expect(allowed()).toEqual(["studio"]);
    modes.set("teleop");
    expect(allowed()).toEqual([]);
  });

  it("drops to idle when a driver dies mid-motion", () => {
    const modes = createModes({ arms: fakeArms(), broadcast });
    modes.set("hands");
    modes.onDriverExit("follower");
    expect(modes.current()).toBe("idle");
    expect(modes.view().note).toMatch(/follower driver exited/);
  });
});
