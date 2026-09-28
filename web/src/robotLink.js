import { BRIDGE_URL } from "./config.js";

/* =========================================================================
   ROBOT BRIDGE LINK (backend stub)
   Streams filtered joint commands over WebSocket at a fixed rate.
   Disconnected by default so it can never affect the render loop.
   ========================================================================= */
const SEND_HZ = 50;
const SEND_INTERVAL_MS = 1000 / SEND_HZ;

let socket = null;
let connected = false;
let lastSend = 0;
let dotEl = null;
let labelEl = null;
let relaxEl = null;
const listeners = new Set();
// Latched locally so the button reads right even before the arm answers.
let relaxed = false;
// While mirroring, the real arm is the input and the sim is the output, so the
// joint stream must stop: commanding an arm you are reading fights the hand
// posing it.
let mirroring = false;

export function setMirroring(on) {
  mirroring = on;
}

function setBadge(color, text) {
  if (dotEl) dotEl.className = `w-2 h-2 rounded-full ${color}`;
  if (labelEl) labelEl.textContent = text;
}

export function isConnected() {
  return connected;
}

/* Backend -> client frames: arm status, present position, driver logs. */
export function onBridgeMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function sendCommand(obj) {
  if (!connected || !socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(obj));
  return true;
}

/* Cuts torque to the real arm, or re-enables it holding wherever it now is.
   Sent as its own command rather than by stopping the joint stream: a stream
   that simply stops leaves the arm powered and holding its last pose. */
export function setRelaxed(next, arm = "all") {
  relaxed = next;
  if (relaxEl) {
    relaxEl.textContent = relaxed ? "Relaxed" : "Relax";
  }
  if (connected && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ cmd: relaxed ? "relax" : "hold", arm }));
  }
}

export function connect() {
  if (socket) return;
  setBadge("bg-amber-400 animate-pulse", "Linking");
  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch (err) {
    console.warn("Bridge connect failed:", err);
    socket = null;
    setBadge("bg-rose-500", "Bridge");
    return;
  }

  socket.addEventListener("open", () => {
    connected = true;
    setBadge("bg-emerald-400", "Linked");
    // Linking the studio is taking the arms: the bridge only forwards its
    // joints in manual mode, which also stops teleop and hands.
    socket.send(JSON.stringify({ cmd: "mode", mode: "manual", note: "settings page linked" }));
  });
  socket.addEventListener("close", () => {
    connected = false;
    socket = null;
    setBadge("bg-slate-500", "Bridge");
  });
  socket.addEventListener("error", () => {
    setBadge("bg-rose-500", "Bridge");
  });
  socket.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    for (const fn of listeners) fn(msg);
  });
}

export function disconnect() {
  if (socket) socket.close();
  socket = null;
  connected = false;
  setBadge("bg-slate-500", "Bridge");
}

/* Called every animation frame; throttled internally and a no-op when
   the bridge is not connected, so idle cost is a single timestamp compare. */
export function streamJoints(joints, cartesian, nowMs) {
  if (!connected || socket.readyState !== WebSocket.OPEN) return;
  if (relaxed || mirroring) return; // a relaxed or mirrored arm takes no targets
  if (nowMs - lastSend < SEND_INTERVAL_MS) return;
  lastSend = nowMs;
  socket.send(JSON.stringify({
    t: nowMs,
    joints,
    cartesian: {
      x: cartesian.x, y: cartesian.y, z: cartesian.z,
      pitch: cartesian.pitch, roll: cartesian.roll, gripper: cartesian.gripper
    }
  }));
}

export function initRobotLink() {
  dotEl = document.getElementById("robot-link-dot");
  labelEl = document.getElementById("robot-link-label");
  relaxEl = document.getElementById("arm-relax-label");
  document.getElementById("btn-robot-link").addEventListener("click", () => {
    if (socket) disconnect();
    else connect();
  });
  document.getElementById("btn-arm-relax").addEventListener("click", () => setRelaxed(!relaxed));
  // Esc is the panic key: it always relaxes, never re-enables.
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !relaxed) setRelaxed(true);
  });
}
