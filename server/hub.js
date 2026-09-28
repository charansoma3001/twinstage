/* =========================================================================
   What the bridge does with a client's messages, and the snapshot it sends
   them. Browser-safe, so the Pages demo runs the same routing against
   simulated drivers that the real bridge runs against real ones.
   ========================================================================= */
const BODY = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"];

/* A joint map the driver can load: each body joint needs sign +/-1 and a
   finite offset. The gripper entry is optional. */
export function isValidJointMap(body) {
  return !!body && BODY.every((n) => body[n] && (body[n].sign === 1 || body[n].sign === -1) &&
    Number.isFinite(body[n].offset_deg));
}

export function createHub({ arms, modes, base, broadcast, phoneUrls = () => [] }) {
  let lastCommand = null;
  let commandCount = 0;

  const snapshot = () => ({
    robot: "so-101",
    arms: arms.view(),
    // The follower under its old key, for anything still reading it.
    arm: arms.view().follower,
    mode: modes.view(),
    base: base.view(),
    phoneUrls: phoneUrls()
  });

  /* `joints` is [j1_pan, j2_shoulder, j3_elbow, j4_wrist_flex, j5_wrist_roll,
     j6_gripper], all radians in the URDF's convention -- including the
     gripper, which is its joint angle over 0..1.74533 rad, not a 0..1
     aperture. The driver owns every unit conversion and every safety clamp;
     this is a pipe, gated by mode. */
  function routeJoints(msg) {
    const name = msg.arm || "follower";
    if (!arms.has(name) || !modes.allowsJointsFrom(msg.src || "studio")) return;
    lastCommand = msg;
    commandCount++;
    arms.send(name, { cmd: "joints", j: msg.joints });
  }

  function targetsOf(msg) {
    if (msg.arm === "all") return arms.names;
    return arms.has(msg.arm || "follower") ? [msg.arm || "follower"] : [];
  }

  /* One message from one client. `client` needs only send(string). */
  function handle(client, msg) {
    switch (msg.cmd) {
      case "drive": return base.drive(client, msg);
      case "base_stop": return void base.send({ cmd: "stop" });
      case "base_reset_odom": return void base.send({ cmd: "reset_odom" });
      case "mode": return modes.set(msg.mode, msg.note || "", client);
      case "freeze": return modes.freeze("stop pressed");
      case "telemetry": {
        // Control commands go straight through to the named driver(s).
        const names = targetsOf(msg);
        const sent = names.filter((n) => arms.send(n, { cmd: "telemetry", on: !!msg.on, ...(msg.hz ? { hz: msg.hz } : {}) }));
        if (msg.on && !sent.length) {
          // No driver at all: say so, or the page waits forever for readings
          // that were never going to come.
          broadcast({ type: "log", msg: `no ${names.join("/") || "arm"} driver running - check ARM_PORT / LEADER_PORT` });
          console.warn("[bridge] telemetry requested but no driver is running");
        }
        return;
      }
      case "relax":
      case "hold":
        for (const n of targetsOf(msg)) arms.send(n, { cmd: msg.cmd });
        console.log(`[bridge] ${msg.cmd} ${msg.arm || "follower"} requested`);
        return;
      default:
        if (Array.isArray(msg.joints) && msg.joints.length === 6 && msg.joints.every(Number.isFinite)) routeJoints(msg);
    }
  }

  return {
    handle,
    snapshot,
    hello: () => ({ type: "hello", hz: 50, ...snapshot() }),
    health: () => ({ ok: true, commands: commandCount, ...snapshot() }),
    stats: () => ({ lastCommand, commandCount }),
    clientLeft: (client) => base.clientLeft(client)
  };
}
