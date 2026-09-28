import { createBridgeLink } from "./bridge.js";

/* =========================================================================
   The settings page's bridge link: connects on demand, streams the studio's
   joint targets at a fixed rate, and owns Relax. Disconnected by default so
   it can never affect the render loop.
   ========================================================================= */
const SEND_HZ = 50;
const SEND_INTERVAL_MS = 1000 / SEND_HZ;

const link = createBridgeLink();
let lastSend = 0;
let dotEl = null;
let labelEl = null;
let relaxEl = null;
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

export const isConnected = link.isConnected;

/* Backend -> client frames: arm status, present position, driver logs. */
export const onBridgeMessage = link.onMessage;

export const sendCommand = link.send;

/* Cuts torque to the real arm, or re-enables it holding wherever it now is.
   Sent as its own command rather than by stopping the joint stream: a stream
   that simply stops leaves the arm powered and holding its last pose. */
export function setRelaxed(next, arm = "all") {
  relaxed = next;
  if (relaxEl) {
    relaxEl.textContent = relaxed ? "Relaxed" : "Relax";
  }
  link.send({ cmd: relaxed ? "relax" : "hold", arm });
}

link.onOpen(() => {
  setBadge("bg-emerald-400", "Linked");
  // Linking the studio is taking the arms: the bridge only forwards its
  // joints in manual mode, which also stops teleop and hands.
  link.send({ cmd: "mode", mode: "manual", note: "settings page linked" });
});
link.onClose(() => setBadge("bg-slate-500", "Bridge"));

function toggleLink() {
  if (link.isConnected() || link.isLinking()) {
    link.disconnect();
  } else {
    setBadge("bg-amber-400 animate-pulse", "Linking");
    link.connect();
  }
}

/* Called every animation frame; throttled internally and a no-op when
   the bridge is not connected, so idle cost is a single timestamp compare. */
export function streamJoints(joints, cartesian, nowMs) {
  if (!link.isConnected()) return;
  if (relaxed || mirroring) return; // a relaxed or mirrored arm takes no targets
  if (nowMs - lastSend < SEND_INTERVAL_MS) return;
  lastSend = nowMs;
  link.send({
    t: nowMs,
    joints,
    cartesian: {
      x: cartesian.x, y: cartesian.y, z: cartesian.z,
      pitch: cartesian.pitch, roll: cartesian.roll, gripper: cartesian.gripper
    }
  });
}

export function initRobotLink() {
  dotEl = document.getElementById("robot-link-dot");
  labelEl = document.getElementById("robot-link-label");
  relaxEl = document.getElementById("arm-relax-label");
  document.getElementById("btn-robot-link").addEventListener("click", toggleLink);
  document.getElementById("btn-arm-relax").addEventListener("click", () => setRelaxed(!relaxed));
  // Esc is the panic key: it always relaxes, never re-enables.
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !relaxed) setRelaxed(true);
  });
}
