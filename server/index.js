/* =========================================================================
   Twinstage bridge

   One process, one port: serves the built pages, a WebSocket for both of
   them, and owns every driver child (arms and base). The protocol is in
   docs/protocol.md; the pieces are:

     config.js  environment        arms.js   SO-101 arm drivers
     modes.js   who may command    base.js   LeKiwi base driver
     http.js    pages and /api     driver.js newline-JSON child processes
   ========================================================================= */
import http from "node:http";
import { WebSocketServer } from "ws";
import { PORT, DIST, ARM_CONFIG, ARM_DRY, ARM_PYTHON, ARM_SCRIPT, BASE } from "./config.js";
import { createArms } from "./arms.js";
import { createModes } from "./modes.js";
import { createBase } from "./base.js";
import { createApp, phoneUrls } from "./http.js";

let wss = null;
function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss?.clients ?? []) {
    if (client.readyState === 1) client.send(payload);
  }
}

let modes = null;
const arms = createArms({
  config: ARM_CONFIG, python: ARM_PYTHON, script: ARM_SCRIPT, dry: ARM_DRY, broadcast,
  onPresent: (name, msg) => modes.onPresent(name, msg),
  onDriverExit: (name) => modes.onDriverExit(name)
});
modes = createModes({ arms, broadcast });
const base = await createBase({ config: BASE, broadcast });

let lastCommand = null;
let commandCount = 0;

const snapshot = () => ({
  robot: "so-101",
  arms: arms.view(),
  // The follower under its old key, for anything still reading it.
  arm: arms.view().follower,
  mode: modes.view(),
  base: base.view(),
  phoneUrls: phoneUrls(PORT)
});

const app = createApp({
  dist: DIST,
  armConfig: ARM_CONFIG,
  health: () => ({ ok: true, commands: commandCount, ...snapshot() }),
  stats: () => ({ lastCommand, commandCount })
});
const server = http.createServer(app);
wss = new WebSocketServer({ server });

/* `joints` is [j1_pan, j2_shoulder, j3_elbow, j4_wrist_flex, j5_wrist_roll,
   j6_gripper], all radians in the URDF's convention -- including the gripper,
   which is its joint angle over 0..1.74533 rad, not a 0..1 aperture. The
   driver owns every unit conversion and every safety clamp; this is a pipe,
   gated by mode. */
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

function onClientMessage(ws, msg) {
  switch (msg.cmd) {
    case "drive": return base.drive(ws, msg);
    case "base_stop": return void base.send({ cmd: "stop" });
    case "base_reset_odom": return void base.send({ cmd: "reset_odom" });
    case "mode": return modes.set(msg.mode, msg.note || "", ws);
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

wss.on("connection", (ws) => {
  console.log("[bridge] client connected");
  ws.send(JSON.stringify({ type: "hello", hz: 50, ...snapshot() }));
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    onClientMessage(ws, msg);
  });
  ws.on("close", () => {
    console.log("[bridge] client disconnected");
    base.clientLeft(ws);
  });
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { arms.stopAll(); base.stop(); setTimeout(() => process.exit(0), 900); });
}
process.on("exit", () => { arms.stopAll("SIGKILL"); base.kill(); });

/* A port already in use is nearly always a bridge left over from a previous
   run, and the default report for it is an unhandled 'error' event and a
   stack trace. Say what it is and how to clear it instead.

   The listener goes on both the http server and the WebSocketServer: ws
   re-emits the http server's error on itself, and an unhandled 'error' event
   there is what produces the stack trace even when the http server has a
   handler. */
const onServerError = (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[bridge] port ${PORT} is already in use - another bridge is probably still running.`);
    console.error(`[bridge] find it with:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    console.error("[bridge] then kill that pid, or start this one with a different PORT.");
  } else {
    console.error("[bridge]", err.message);
  }
  arms.stopAll();
  base.stop();
  process.exit(1);
};
server.on("error", onServerError);
wss.on("error", onServerError);

server.listen(PORT, () => {
  console.log(`[bridge] http + ws listening on http://localhost:${PORT}`);
  // The phone drive page needs an address it can reach, not localhost.
  for (const u of phoneUrls(PORT)) console.log(`[bridge] phone drive page: ${u}`);
  arms.startAll();
  base.start();
});
