/* =========================================================================
   MODE: who is allowed to command which arm

   idle       nothing is forwarded; each arm holds per its own watchdog
   teleop     the leader is limp and read at TELEOP_HZ; its reading is the
              follower's goal. Browser joint streams are ignored.
   hands      both arms are powered and take joints from the stage page
   primitive  as hands, but the stage is running task primitives (rest,
              pick & place, pinch, wave) instead of reading hands
   manual     the settings page drives the arms (sliders, demos, joint map)
   ========================================================================= */
export const MODES = ["idle", "teleop", "hands", "primitive", "manual"];
// A leader read costs ~1 ms (p50, measured), so it can be read every 20 ms tick.
export const TELEOP_HZ = 50;
// Hands -> Teleop drops the leader's torque; this is the warning before it does.
export const RELAX_COUNTDOWN_MS = 3000;

export function createModes({ arms, broadcast }) {
  let mode = "idle";
  let note = "";
  let pending = null;
  let pendingTimer = null;

  const view = () => ({ type: "mode", mode, note, pending });

  function refuse(ws, why) {
    console.warn("[mode] refused:", why);
    ws?.send(JSON.stringify({ ...view(), refused: why }));
  }

  function enter(next, why) {
    const prev = mode;
    mode = next;
    note = why;
    if (next === "teleop") {
      arms.send("leader", { cmd: "relax" });
      arms.send("leader", { cmd: "telemetry", on: true, hz: TELEOP_HZ });
    } else if (prev === "teleop") {
      arms.send("leader", { cmd: "telemetry", on: false });
    }
    if (next === "hands" || next === "primitive") {
      // Torque on where the leader is now; stage targets are slewed to from there.
      arms.send("leader", { cmd: "hold" });
      arms.send("follower", { cmd: "hold" });
    }
    console.log(`[mode] ${prev} -> ${next}${why ? ` (${why})` : ""}`);
    broadcast(view());
  }

  function set(next, why = "", ws = null) {
    if (!MODES.includes(next)) return;
    const L = arms.state("leader"), F = arms.state("follower");
    if (next === "teleop" && !(L.ready && F.ready)) return refuse(ws, "teleop needs both the leader and the follower running");
    if (next === "hands" || next === "primitive") {
      if (!(L.ready && F.ready)) return refuse(ws, `${next} needs both the leader and the follower running`);
      const unmapped = arms.names.filter((n) => arms.state(n).identityMap && !arms.state(n).dryRun);
      if (unmapped.length) return refuse(ws, `no joint map for ${unmapped.join(" and ")} - measure it in /settings first`);
    }
    clearTimeout(pendingTimer);
    pending = null;

    if (next === "teleop" && mode !== "teleop" && L.ready && !L.relaxed) {
      // The leader is about to go limp wherever it is. Freeze everything,
      // give whoever is next to it three seconds, then drop it.
      mode = "idle";
      pending = { mode: "teleop", at: Date.now() + RELAX_COUNTDOWN_MS };
      note = "Hold the leader - it goes limp in 3 s";
      broadcast(view());
      pendingTimer = setTimeout(() => {
        pending = null;
        enter("teleop", why);
      }, RELAX_COUNTDOWN_MS);
      return;
    }
    enter(next, why);
  }

  /* Freeze: stop forwarding and hold both arms where they are. Unlike relax,
     nothing drops under gravity. */
  function freeze(why) {
    clearTimeout(pendingTimer);
    pending = null;
    for (const n of arms.names) arms.send(n, { cmd: "hold" });
    enter("idle", why);
  }

  /* The leader's reading is the follower's goal, in teleop only. */
  function onPresent(name, msg) {
    if (name === "leader" && mode === "teleop") arms.send("follower", { cmd: "joints_deg", pos: msg.pos });
  }

  /* A driver that dies mid-motion drops every mode that moves both arms. */
  function onDriverExit(name) {
    if (mode === "teleop" || mode === "hands" || mode === "primitive") set("idle", `${name} driver exited`);
  }

  /* Browser joint streams are gated by mode: the stage page drives in hands
     and primitive, the settings page in manual. */
  function allowsJointsFrom(src) {
    return ((mode === "hands" || mode === "primitive") && src === "stage") ||
      (mode === "manual" && src === "studio");
  }

  return { view, set, freeze, onPresent, onDriverExit, allowsJointsFrom, current: () => mode };
}
