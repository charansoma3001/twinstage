import { loadPrefs } from "../prefs.js";
import { createBridgeLink } from "../bridge.js";

/* =========================================================================
   The stage's shared state: what the bridge last said, what each arm is
   doing, and the page's own choices. Every stage module reads and writes S.
   ========================================================================= */
export const ARMS = ["leader", "follower"];

export const el = (id) => document.getElementById(id);
// The big screen should never need a click to come back.
export const link = createBridgeLink({ reconnectMs: 1000 });

export const S = {
  view: "arms",
  mode: "idle",
  modeNote: "",
  pending: null,
  arms: { leader: null, follower: null },          // bridge's view of each driver
  present: { leader: null, follower: null },       // latest LeRobot-unit reading
  maps: { leader: null, follower: null },
  filtered: { leader: null, follower: null },      // EMA'd Cartesian target
  lastSend: { leader: 0, follower: 0 },
  base: null,
  phoneUrls: [],
  prim: null,                                      // { name, t0 } while a primitive runs
  primArms: "both",                                // "leader" | "follower" | "both"
  handsArms: "both",                               // "follower" | "both" in hands mode
  prefs: loadPrefs()
};

export function primRuns(arm) {
  return S.primArms === "both" || S.primArms === arm;
}

// The arm on the operator's left runs the mirror image, so the pair is symmetric.
export function isLeftArm(arm) {
  return (arm === "leader") === (S.prefs.leaderSide === "left");
}

/* Everything on screen that follows a measurement moves by exponential
   approach, so a 20-30 Hz reading reads as motion at the display's rate.
   TAU is the time to close ~63% of a gap. */
export const TAU_POSE = 0.07;
export const TAU_UI = 0.12;
export const approach = (dt, tau) => 1 - Math.exp(-dt / tau);
