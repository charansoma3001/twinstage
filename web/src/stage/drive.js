import { armToUrdf } from "../jointMap.js";
import { keepOut, inwardLimit as keepOutLimit } from "./keepout.js";
import * as twin from "./twin.js";
import { fresh } from "./hands.js";
import {
  primitiveTarget, mirror, mirrorStation, REST_JOINTS, STATION_A, STATION_B, PICK_HEIGHT, blockState
} from "../primitives.js";
import { S, link, isLeftArm, primRuns, approach, TAU_POSE } from "./state.js";

/* =========================================================================
   Driving the arms from the stage: every frame, each arm's target (a hand, a
   primitive, or the arm's own reading) becomes joints for the twin, and in
   hands and primitive modes also for the bridge. Every target the stage
   sends goes through the keep-out first.
   ========================================================================= */
const SEND_MS = 20;
const EMA = 0.35;

function toUrdf(arm, pos) {
  return armToUrdf(S.maps[arm] || S.maps.follower, pos);
}


function inwardLimit() {
  return keepOutLimit(S.prefs.armSpacingCm, S.prefs.minGapCm);
}

function filterTarget(arm, t) {
  const f = S.filtered[arm];
  if (!f) {
    S.filtered[arm] = { ...t };
    return S.filtered[arm];
  }
  for (const k of ["x", "y", "z", "pitch", "roll", "gripper"]) f[k] += EMA * (t[k] - f[k]);
  return f;
}

function stream(arm, q, now) {
  if (now - S.lastSend[arm] >= SEND_MS) {
    S.lastSend[arm] = now;
    link.send({ joints: q, arm, src: "stage" });
  }
}

function runPrimitive(arm, now) {
  const { name, t0 } = S.prim;
  const left = isLeftArm(arm);
  if (name === "rest") {
    twin.setPose(arm, REST_JOINTS);
    twin.setTarget(arm, null);
    twin.setStations(arm, null);
    twin.setBlock(arm, null);
    S.filtered[arm] = null;
    stream(arm, REST_JOINTS, now);
    return;
  }
  let t = primitiveTarget(name, (now - t0) / 1000);
  if (left) t = mirror(t);
  const { cart, q } = keepOut(filterTarget(arm, t), left, inwardLimit());
  // Blocked: send nothing, and the driver holds the last pose that fitted.
  if (!q) return;
  twin.setPose(arm, q);
  twin.setTarget(arm, cart);
  const stations = name === "pickAndPlace"
    ? [STATION_A, STATION_B].map((st) => stationOnTable(left ? mirrorStation(st) : st, left))
    : null;
  twin.setStations(arm, stations);
  twin.setBlock(arm, stations ? blockState((now - t0) / 1000, stations) : null);
  stream(arm, q, now);
}

/* Where the arm really picks at a station: the keep-out may move it. */
function stationOnTable(st, left) {
  const pick = { ...st, y: PICK_HEIGHT, pitch: -Math.PI / 2, roll: 0, gripper: 0.9 };
  const { cart } = keepOut(pick, left, inwardLimit());
  return cart ? { x: cart.x, z: cart.z } : st;
}

/* One frame for one arm. */
export function driveArm(arm, now, dt) {
  const h = fresh(arm);
  if (S.mode === "primitive" && S.prim && primRuns(arm)) {
    runPrimitive(arm, now);
    return;
  }
  twin.setStations(arm, null);
  twin.setBlock(arm, null);
  // Follower-only hands: the leader is not driven and shows its readings.
  const handDriven = S.mode === "hands" && (S.handsArms === "both" || arm === "follower");
  if (handDriven) {
    if (h) {
      const { cart, q } = keepOut(filterTarget(arm, h.cart), isLeftArm(arm), inwardLimit());
      if (!q) return;   // blocked: nothing sent, the driver holds
      twin.setPose(arm, q);
      twin.setTarget(arm, cart);
      // Only while the hand is in view: a lost hand stops the stream and the
      // driver's watchdog holds the arm where it is.
      stream(arm, q, now);
    } else {
      twin.setTarget(arm, null);
    }
  } else {
    S.filtered[arm] = null;
    twin.setTarget(arm, null);
    if (S.present[arm]) {
      // Readings arrive at 20-30 Hz; glide between them. Starts from where
      // the twin already is, so leaving hands or a primitive does not jump.
      const goal = toUrdf(arm, S.present[arm]);
      const cur = twin.jointValues(arm) || goal;
      const k = approach(dt, TAU_POSE);
      twin.setPose(arm, cur.map((v, i) => v + (goal[i] - v) * k));
    }
  }
}
