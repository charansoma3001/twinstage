import { S, ARMS, link } from "./state.js";
import { apiFetch } from "../bridge.js";
import { paintMode, paintPhone, runCountdown, toast } from "./paint.js";

/* =========================================================================
   What the bridge tells the stage: its hello, mode changes, and each
   driver's frames. The bridge owns the mode; the stage only reflects it.
   ========================================================================= */
/* ---------------------------------------------------------------------- */
function requestTelemetry() {
  // Readings drive the twin outside hands mode. The bridge runs the leader at
  // its own teleop rate while in teleop, so it is only asked for otherwise.
  link.send({ cmd: "telemetry", arm: "follower", on: true, hz: 20 });
  if (S.mode !== "teleop") link.send({ cmd: "telemetry", arm: "leader", on: true, hz: 20 });
}

export function onMessage(msg) {
  if (msg.type === "hello") {
    S.arms = msg.arms || S.arms;
    S.base = msg.base || null;
    S.phoneUrls = msg.phoneUrls || [];
    if (msg.mode) Object.assign(S, { mode: msg.mode.mode, modeNote: msg.mode.note, pending: msg.mode.pending });
    for (const arm of ARMS) if (S.arms[arm]?.last?.command) S.present[arm] = S.arms[arm].last.command;
    paintPhone();
    paintMode();
    requestTelemetry();
    runCountdown();
  } else if (msg.type === "mode") {
    const prevMode = S.mode;
    Object.assign(S, { mode: msg.mode, modeNote: msg.note || "", pending: msg.pending || null });
    // Leaving primitive mode (Stop, another mode, a refusal) ends the routine.
    if (S.mode !== "primitive") S.prim = null;
    if (msg.refused) toast(msg.refused);
    paintMode();
    runCountdown();
    if (prevMode !== S.mode) requestTelemetry();
  } else if (msg.arm && ARMS.includes(msg.arm)) {
    const arm = msg.arm;
    const a = (S.arms[arm] ||= { spawned: true });
    if (msg.type === "ready") {
      Object.assign(a, { spawned: true, ready: true, restarting: false, gaveUp: false, dryRun: !!msg.dry_run, relaxed: !!msg.relaxed, identityMap: !!msg.identity_map });
      if (msg.present) S.present[arm] = msg.present;
      requestTelemetry();
    } else if (msg.type === "present") {
      S.present[arm] = msg.pos;
    } else if (msg.type === "status") {
      a.relaxed = !!msg.relaxed;
      // Without telemetry, the commanded pose is the next best picture.
      if (!S.present[arm]) S.present[arm] = msg.command;
    } else if (msg.kind === "exit") {
      a.ready = false;
    } else if (msg.kind === "restarting") {
      a.restarting = true;
      toast(`${arm === "leader" ? "Leader" : "Follower"} lost its bus, reconnecting`);
    } else if (msg.kind === "gave_up") {
      a.restarting = false;
      a.gaveUp = true;
      toast(`${arm === "leader" ? "Leader" : "Follower"} keeps dropping: check its cable and power`);
    }
  } else if (msg.type === "base") {
    S.base = S.base || { spawned: true };
    if (msg.kind === "ready") Object.assign(S.base, { spawned: true, ready: true, dryRun: msg.dry_run });
    if (msg.kind === "exit") S.base.ready = false;
  }
}

export function onLinkDrop() {
  S.arms = { leader: null, follower: null };
  S.base = null;
}

export async function loadMaps() {
  for (const arm of ARMS) {
    try {
      const r = await apiFetch(`api/joint-map?arm=${arm}`);
      S.maps[arm] = r.ok ? await r.json() : null;
    } catch {
      S.maps[arm] = null;
    }
  }
}
