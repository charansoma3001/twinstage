/* =========================================================================
   SO-101 Bridge Server

   - Serves the built frontend from ../dist when it exists.
   - Exposes a WebSocket endpoint that receives joint/cartesian commands
     from the studio at ~50 Hz.
   - Owns the arm drivers: ARM_PORT (follower) and LEADER_PORT (leader) each
     spawn drivers/so101_arm.py under the LeRobot venv, fed newline JSON. The
     children die with this process, so there is no way to leave a
     torque-enabled arm running behind a dead bridge.
   - Owns the mode (idle / teleop / hands / manual) that decides which
     client's commands reach which arm.
   ========================================================================= */
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import express from "express";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

/* Arm driver configuration, all optional. ARM_PORT is the follower,
   LEADER_PORT the leader. With neither set the bridge accepts and logs
   commands and moves nothing. ARM_DRY applies to both. */
const ARM_DRY = process.env.ARM_DRY === "1";
// The interpreter needs LeRobot installed: activate its venv or point ARM_PYTHON at it.
const ARM_PYTHON = process.env.ARM_PYTHON || "python3";
const DRIVERS_DIR = path.join(__dirname, "..", "drivers");
const ARM_SCRIPT = path.join(DRIVERS_DIR, "so101_arm.py");
const ARM_CONFIG = {
  follower: {
    port: process.env.ARM_PORT || null,
    id: process.env.ARM_ID || "follower",
    map: path.join(DRIVERS_DIR, "joint_map.json"),
    calibrationDir: null,
    startRelaxed: false
  },
  leader: {
    port: process.env.LEADER_PORT || null,
    id: process.env.LEADER_ID || "leader",
    map: path.join(DRIVERS_DIR, "joint_map_leader.json"),
    // The leader was calibrated as a teleoperator, so its file lives there.
    calibrationDir: process.env.LEADER_CAL_DIR ||
      path.join(os.homedir(), ".cache", "huggingface", "lerobot", "calibration", "teleoperators", "so_leader"),
    startRelaxed: true
  }
};
const ARM_NAMES = Object.keys(ARM_CONFIG);
// A leader read costs ~1 ms (p50, measured), so it can be read every 20 ms tick.
const TELEOP_HZ = 50;
// Hands -> Teleop drops the leader's torque; this is the warning before it does.
const RELAX_COUNTDOWN_MS = 3000;

/* LeKiwi base, optional. BASE_HOST is an ssh destination (e.g. pi@lekiwi.local): the
   driver is sent over ssh and runs on the base's Pi. BASE_DRY=1 runs it here
   instead, integrating commands and touching no hardware. */
const BASE_HOST = process.env.BASE_HOST || null;
const BASE_DRY = process.env.BASE_DRY === "1";
const BASE_PYTHON = process.env.BASE_PYTHON || "~/lerobot/.venv/bin/python";
const BASE_SERIAL = process.env.BASE_SERIAL || "/dev/ttyACM0";
const BASE_SCRIPT = path.join(DRIVERS_DIR, "lekiwi_base.py");
// Unique on the Pi, so a driver orphaned by a dropped ssh link can be found.
const BASE_TAG = "twinstage:lekiwi_base";

const DIST = path.join(__dirname, "..", "dist");

// Where a phone on the same network can reach the drive page.
function phoneUrls() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(`http://${a.address}:${PORT}/drive`);
    }
  }
  return out;
}
const app = express();
app.use(express.json());
app.use(express.static(DIST));
app.get("/drive", (_req, res) => res.sendFile(path.join(DIST, "drive.html")));

let lastCommand = null;
let commandCount = 0;

/* =========================================================================
   ARM DRIVER CHILD PROCESSES
   ========================================================================= */
// A driver that exits on its own (bus lost, USB hiccup) is restarted, with a
// growing delay, up to RESTART_MAX times a minute. Shutting down turns it off.
const RESTART_MAX = 5;
let shuttingDown = false;

const arms = Object.fromEntries(ARM_NAMES.map((name) => [name, {
  proc: null,
  restarts: [],
  state: { spawned: false, ready: false, dryRun: ARM_DRY, relaxed: false, identityMap: true, last: null }
}]));

function startArm(name) {
  const cfg = ARM_CONFIG[name];
  const tag = `[${name}]`;
  if (!cfg.port) {
    console.log(`[bridge] ${name === "follower" ? "ARM_PORT" : "LEADER_PORT"} unset - no ${name} arm`);
    return;
  }
  const args = [ARM_SCRIPT, "--port", cfg.port, "--id", cfg.id, "--map", cfg.map];
  if (cfg.calibrationDir) args.push("--calibration-dir", cfg.calibrationDir);
  if (cfg.startRelaxed) args.push("--start-relaxed");
  if (ARM_DRY) args.push("--dry-run");
  if (ARM_DRY && process.env[`${name.toUpperCase()}_DRY_PRESENT`]) {
    args.push("--dry-present", process.env[`${name.toUpperCase()}_DRY_PRESENT`]);
  }
  console.log(`${tag} spawning ${ARM_PYTHON} ${args.join(" ")}`);

  const a = arms[name];
  a.proc = spawn(ARM_PYTHON, args, { stdio: ["pipe", "pipe", "inherit"] });
  a.state.spawned = true;
  // A driver that has just died still looks alive until its exit event, and a
  // write to its closed stdin raises EPIPE; unhandled, that kills the bridge
  // and with it the other arm. The exit handler deals with the death itself.
  a.proc.stdin.on("error", (err) => console.warn(`${tag} stdin: ${err.code || err.message}`));

  // The driver answers in newline JSON; forward it to every client so the UI
  // can show what the hardware is actually doing. `arm` says which one.
  createInterface({ input: a.proc.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log(tag, line);
      return;
    }
    if (msg.type === "ready") {
      a.state.ready = true;
      a.state.dryRun = !!msg.dry_run;
      a.state.relaxed = !!msg.relaxed;
      a.state.identityMap = !!msg.identity_map;
      console.log(`${tag} ready on ${msg.port} (${msg.dry_run ? "dry run" : "LIVE"}), limits`, msg.limits);
      if (msg.identity_map) console.warn(`${tag} no ${path.basename(cfg.map)} - measure it in /settings before driving it from hands`);
    } else if (msg.type === "status") {
      a.state.last = msg;
      a.state.relaxed = !!msg.relaxed;
    } else if (msg.type === "present") {
      onPresent(name, msg);
    } else if (msg.type === "timing") {
      console.log(`${tag} loop ${msg.loop_p50}/${msg.loop_p95} ms (p50/p95 of ${msg.budget_ms} ms), ` +
        `bus ${msg.bus_p50}/${msg.bus_p95} ms, overruns ${msg.overruns}, bus errors ${msg.bus_errors}`);
    } else {
      console.log(tag, msg.type, msg.msg ?? "");
    }
    broadcast({ type: "arm", ...msg, arm: name });
  });

  a.proc.on("exit", (code, signal) => {
    console.log(`${tag} driver exited (code ${code}, signal ${signal})`);
    a.proc = null;
    a.state.ready = false;
    broadcast({ type: "arm", kind: "exit", code, arm: name });
    if (mode === "teleop" || mode === "hands" || mode === "primitive") setMode("idle", `${name} driver exited`);
    if (shuttingDown || code === 0) return;
    const now = Date.now();
    a.restarts = a.restarts.filter((t) => now - t < 60000);
    if (a.restarts.length >= RESTART_MAX) {
      console.error(`${tag} exited ${RESTART_MAX} times in a minute - not restarting. Check the cable and power, then restart the bridge.`);
      broadcast({ type: "arm", kind: "gave_up", arm: name });
      return;
    }
    a.restarts.push(now);
    const delay = 1000 * a.restarts.length;
    console.log(`${tag} restarting in ${delay / 1000} s (${a.restarts.length}/${RESTART_MAX} this minute)`);
    broadcast({ type: "arm", kind: "restarting", in: delay, arm: name });
    setTimeout(() => { if (!shuttingDown && !a.proc) startArm(name); }, delay);
  });
  a.proc.on("error", (err) => console.error(`${tag} spawn failed:`, err.message));
}

function sendArm(name, obj) {
  const p = arms[name]?.proc;
  if (!p || p.stdin.destroyed) return false;
  p.stdin.write(JSON.stringify(obj) + "\n");
  return true;
}

function armsView() {
  return Object.fromEntries(ARM_NAMES.map((n) => [n, {
    ...arms[n].state, port: ARM_CONFIG[n].port, id: ARM_CONFIG[n].id,
    live: !!arms[n].proc && !arms[n].state.dryRun
  }]));
}

/* The child is killed on every exit path. disable_torque_on_disconnect is on,
   so an arm relaxes at its last commanded pose rather than holding it. */
function stopArm(signal = "SIGINT") {
  shuttingDown = true;
  for (const n of ARM_NAMES) if (arms[n].proc) arms[n].proc.kill(signal);
}

/* =========================================================================
   MODE: who is allowed to command which arm

   idle     nothing is forwarded; each arm holds per its own watchdog
   teleop   the leader is limp and read at TELEOP_HZ; its reading is the
            follower's goal. Browser joint streams are ignored.
   hands    both arms are powered and take joints from the stage page
   primitive  as hands, but the stage is running task primitives (rest,
            pick & place, pinch, wave) instead of reading hands
   manual   the settings page drives the arms (sliders, demos, joint map)
   ========================================================================= */
let mode = "idle";
let modeNote = "";
let pendingTimer = null;
let pending = null;

function modeView() {
  return { type: "mode", mode, note: modeNote, pending };
}

function refuse(ws, why) {
  console.warn("[mode] refused:", why);
  ws?.send(JSON.stringify({ type: "mode", ...modeView(), refused: why }));
}

function setMode(next, note = "", ws = null) {
  if (!["idle", "teleop", "hands", "primitive", "manual"].includes(next)) return;
  const L = arms.leader.state, F = arms.follower.state;
  if (next === "teleop" && !(L.ready && F.ready)) return refuse(ws, "teleop needs both the leader and the follower running");
  if (next === "hands" || next === "primitive") {
    if (!(L.ready && F.ready)) return refuse(ws, `${next} needs both the leader and the follower running`);
    const unmapped = ARM_NAMES.filter((n) => arms[n].state.identityMap && !arms[n].state.dryRun);
    if (unmapped.length) return refuse(ws, `no joint map for ${unmapped.join(" and ")} - measure it in /settings first`);
  }
  clearTimeout(pendingTimer);
  pending = null;

  const leaderPowered = L.ready && !L.relaxed;
  if (next === "teleop" && mode !== "teleop" && leaderPowered) {
    // The leader is about to go limp wherever it is. Freeze everything,
    // give whoever is next to it three seconds, then drop it.
    mode = "idle";
    pending = { mode: "teleop", at: Date.now() + RELAX_COUNTDOWN_MS };
    modeNote = "Hold the leader - it goes limp in 3 s";
    broadcast(modeView());
    pendingTimer = setTimeout(() => {
      pending = null;
      enterMode("teleop", note);
    }, RELAX_COUNTDOWN_MS);
    return;
  }
  enterMode(next, note);
}

function enterMode(next, note) {
  const prev = mode;
  mode = next;
  modeNote = note;
  if (next === "teleop") {
    sendArm("leader", { cmd: "relax" });
    sendArm("leader", { cmd: "telemetry", on: true, hz: TELEOP_HZ });
  } else if (prev === "teleop") {
    sendArm("leader", { cmd: "telemetry", on: false });
  }
  if (next === "hands" || next === "primitive") {
    // Torque on where the leader is now; stage targets are slewed to from there.
    sendArm("leader", { cmd: "hold" });
    sendArm("follower", { cmd: "hold" });
  }
  console.log(`[mode] ${prev} -> ${next}${note ? ` (${note})` : ""}`);
  broadcast(modeView());
}

function onPresent(name, msg) {
  if (name === "leader" && mode === "teleop") {
    sendArm("follower", { cmd: "joints_deg", pos: msg.pos });
  }
}

/* Freeze: stop forwarding and hold both arms where they are. Unlike relax,
   nothing drops under gravity. */
function freeze(note) {
  clearTimeout(pendingTimer);
  pending = null;
  for (const n of ARM_NAMES) sendArm(n, { cmd: "hold" });
  enterMode("idle", note);
}

/* =========================================================================
   LEKIWI BASE DRIVER
   ========================================================================= */
let base = null;
let baseState = { spawned: false, ready: false, dryRun: BASE_DRY, host: BASE_HOST, last: null };
let basePing = null;
// One driver at a time: whoever last sent a non-zero drive owns the base until
// they have been idle for BASE_OWNER_MS. A stop is accepted from anyone.
const BASE_OWNER_MS = 1000;
let baseOwner = null;
let baseOwnerAt = 0;

function startBase() {
  if (!BASE_HOST && !BASE_DRY) {
    console.log("[bridge] BASE_HOST unset - no LeKiwi base");
    return;
  }
  let cmd, args;
  if (BASE_DRY && !BASE_HOST) {
    cmd = process.env.BASE_LOCAL_PYTHON || "python3";
    args = ["-u", BASE_SCRIPT, "--dry-run", "--tag", BASE_TAG];
  } else {
    // The script travels as base64 in argv: no file to keep in sync on the
    // Pi, and no quoting to get wrong. Neither the bracketed pkill pattern
    // nor "$T:..." spells the tag literally, so pkill stops a stale driver
    // without matching the shell that is running it.
    if (!BASE_SCRIPT_B64) {
      console.error(`[base] cannot read ${BASE_SCRIPT}`);
      return;
    }
    const [pre, post] = BASE_TAG.split(":");
    const remote =
      `pkill -f '[${pre[0]}]${BASE_TAG.slice(1)}' && sleep 0.5; T=${pre}; ` +
      `exec ${BASE_PYTHON} -u -c "import base64,sys; sys.argv[0]='lekiwi_base.py'; ` +
      `exec(compile(base64.b64decode('${BASE_SCRIPT_B64}'),'lekiwi_base.py','exec'),{'__name__':'__main__'})" ` +
      `--port ${BASE_SERIAL} --tag "$T:${post}"${BASE_DRY ? " --dry-run" : ""}`;
    cmd = "ssh";
    args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6",
      "-o", "ServerAliveInterval=2", "-o", "ServerAliveCountMax=3", BASE_HOST, remote];
  }
  const where = BASE_HOST ? `on ${BASE_HOST}` : "locally";
  console.log(`[base] starting ${BASE_DRY ? `dry run ${where}` : `LIVE ${where}:${BASE_SERIAL}`}`);
  base = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
  baseState.spawned = true;
  base.stdin.on("error", (err) => console.warn(`[base] stdin: ${err.code || err.message}`));

  createInterface({ input: base.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log("[base]", line);
      return;
    }
    if (msg.type === "ready") {
      baseState.ready = true;
      baseState.dryRun = !!msg.dry_run;
      console.log(`[base] ready (${msg.dry_run ? "dry run" : "LIVE"}), cap ${msg.max_lin} m/s, ${msg.max_rot} deg/s`);
    } else if (msg.type === "odom") {
      baseState.last = msg;
    } else {
      console.log("[base]", msg.type, msg.msg ?? "");
    }
    const { type: kind, ...rest } = msg;
    broadcast({ type: "base", kind, ...rest });
  });

  // The driver exits after 5 s without a line; the ping is what keeps an idle
  // base alive, and its absence is what frees the port if this process dies.
  basePing = setInterval(() => sendToBase({ cmd: "ping" }), 1000);

  base.on("exit", (code, signal) => {
    console.log(`[base] driver exited (code ${code}, signal ${signal})`);
    clearInterval(basePing);
    base = null;
    baseState.ready = false;
    broadcast({ type: "base", kind: "exit", code });
  });
  base.on("error", (err) => console.error("[base] spawn failed:", err.message));
}

function sendToBase(obj) {
  if (!base || base.stdin.destroyed) return false;
  base.stdin.write(JSON.stringify(obj) + "\n");
  return true;
}

function stopBase() {
  if (!base) return;
  sendToBase({ cmd: "stop" });
  // Closing stdin is the clean path: the driver zeroes the wheels and closes
  // the bus itself. The kill is the fallback if it does not.
  base.stdin.end();
  const b = base;
  setTimeout(() => b.kill("SIGTERM"), 800).unref();
}

function handleDrive(ws, msg) {
  const v = [msg.x, msg.y, msg.w].map(Number);
  if (!v.every(Number.isFinite)) return;
  const now = Date.now();
  const moving = v.some((x) => Math.abs(x) > 0.01);
  const ownerActive = baseOwner && baseOwner !== ws && now - baseOwnerAt < BASE_OWNER_MS;
  if (moving) {
    if (ownerActive) {
      ws.send(JSON.stringify({ type: "base", kind: "busy" }));
      return;
    }
    baseOwner = ws;
    baseOwnerAt = now;
  } else if (ownerActive) {
    // An idle client's key-up must not stop someone else who is driving.
    return;
  }
  sendToBase({ cmd: "drive", x: v[0], y: v[1], w: v[2] });
}

const BASE_SCRIPT_B64 = await readFile(BASE_SCRIPT).then((b) => b.toString("base64")).catch(() => null);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { stopArm(); stopBase(); setTimeout(() => process.exit(0), 900); });
}
process.on("exit", () => { stopArm("SIGKILL"); if (base) base.kill("SIGKILL"); });

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    robot: "so-101",
    commands: commandCount,
    arms: armsView(),
    // The follower under its old key, for anything still reading it.
    arm: armsView().follower,
    mode: modeView(),
    base: { ...baseState, live: !!base && !baseState.dryRun },
    phoneUrls: phoneUrls()
  });
});

app.get("/api/state", (_req, res) => {
  res.json({ lastCommand, commandCount });
});

/* The joint map is measured in the studio -- the render is the instrument --
   so the browser needs a way to persist what the sliders arrived at. Written
   whole; the driver reads it at startup. One file per arm: ?arm=leader. */
function mapPathFor(req) {
  const name = req.query.arm || "follower";
  return ARM_CONFIG[name] ? ARM_CONFIG[name].map : null;
}
app.get("/api/joint-map", async (req, res) => {
  const p = mapPathFor(req);
  if (!p) return res.status(400).json({ error: "unknown arm" });
  try {
    res.json(JSON.parse(await readFile(p, "utf8")));
  } catch {
    res.json(null);
  }
});
app.post("/api/joint-map", async (req, res) => {
  const p = mapPathFor(req);
  if (!p) return res.status(400).json({ error: "unknown arm" });
  const body = req.body;
  const names = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"];
  const ok = body && names.every((n) => body[n] && (body[n].sign === 1 || body[n].sign === -1) &&
    Number.isFinite(body[n].offset_deg));
  if (!ok) return res.status(400).json({ error: "each body joint needs sign +/-1 and a finite offset_deg" });
  await writeFile(p, JSON.stringify(body, null, 2) + "\n");
  console.log(`[bridge] ${path.basename(p)} saved; restart the bridge for the driver to pick it up`);
  res.json({ ok: true, path: p });
});

app.get("/settings", (_req, res) => res.sendFile(path.join(DIST, "settings.html")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* `joints` is [j1_pan, j2_shoulder, j3_elbow, j4_wrist_flex, j5_wrist_roll,
   j6_gripper], all radians in the URDF's convention -- including the gripper,
   which is its joint angle over 0..1.74533 rad, not a 0..1 aperture. The
   driver owns every unit conversion and every safety clamp; this is a pipe,
   gated by mode: the stage page drives in hands, the settings page in manual. */
function routeJoints(msg) {
  const name = msg.arm || "follower";
  if (!ARM_CONFIG[name]) return;
  const src = msg.src || "studio";
  const allowed = ((mode === "hands" || mode === "primitive") && src === "stage") ||
    (mode === "manual" && src === "studio");
  if (!allowed) return;
  lastCommand = msg;
  commandCount++;
  sendArm(name, { cmd: "joints", j: msg.joints });
}

function targetsOf(msg) {
  if (msg.arm === "all") return ARM_NAMES;
  return ARM_CONFIG[msg.arm || "follower"] ? [msg.arm || "follower"] : [];
}

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on("connection", (ws) => {
  console.log("[bridge] studio connected");
  ws.send(JSON.stringify({
    type: "hello", robot: "so-101", hz: 50,
    arms: armsView(),
    arm: armsView().follower,
    mode: modeView(),
    base: { ...baseState, live: !!base && !baseState.dryRun },
    phoneUrls: phoneUrls()
  }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.cmd === "drive") {
      handleDrive(ws, msg);
      return;
    }
    if (msg.cmd === "base_stop") {
      sendToBase({ cmd: "stop" });
      return;
    }
    if (msg.cmd === "base_reset_odom") {
      sendToBase({ cmd: "reset_odom" });
      return;
    }
    if (msg.cmd === "mode") {
      setMode(msg.mode, msg.note || "", ws);
      return;
    }
    if (msg.cmd === "freeze") {
      freeze("stop pressed");
      return;
    }
    // Control commands go straight through to the named driver(s).
    if (msg.cmd === "telemetry") {
      const names = targetsOf(msg);
      const sent = names.filter((n) => sendArm(n, { cmd: "telemetry", on: !!msg.on, ...(msg.hz ? { hz: msg.hz } : {}) }));
      if (msg.on && !sent.length) {
        // No driver at all: say so, or the studio waits forever for readings
        // that were never going to come.
        broadcast({ type: "log", msg: `no ${names.join("/") || "arm"} driver running - check ARM_PORT / LEADER_PORT` });
        console.warn("[bridge] telemetry requested but no driver is running");
      }
      return;
    }
    if (msg.cmd === "relax" || msg.cmd === "hold") {
      for (const n of targetsOf(msg)) sendArm(n, { cmd: msg.cmd });
      console.log(`[bridge] ${msg.cmd} ${msg.arm || "follower"} requested`);
      return;
    }
    if (!Array.isArray(msg.joints) || msg.joints.length !== 6 || !msg.joints.every(Number.isFinite)) return;
    routeJoints(msg);
  });

  ws.on("close", () => {
    console.log("[bridge] studio disconnected");
    // A phone that locks mid-drive closes its socket; the base stops now
    // rather than after the driver's watchdog.
    if (baseOwner === ws) {
      baseOwner = null;
      sendToBase({ cmd: "stop" });
    }
  });
});

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
  stopArm();
  stopBase();
  process.exit(1);
};
server.on("error", onServerError);
wss.on("error", onServerError);

server.listen(PORT, () => {
  console.log(`[bridge] http + ws listening on http://localhost:${PORT}`);
  // The phone drive page needs an address it can reach, not localhost.
  for (const u of phoneUrls()) console.log(`[bridge] phone drive page: ${u}`);
  for (const n of ARM_NAMES) startArm(n);
  startBase();
});
