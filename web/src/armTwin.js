import { onBridgeMessage, sendCommand, setMirroring, setRelaxed } from "./robotLink.js";
import { applyPose } from "./robot.js";
import { BODY_JOINTS as BODY } from "./so101.js";
import { armToUrdf, identityMap } from "./jointMap.js";

/* =========================================================================
   ARM TWIN: measuring the sim <-> hardware joint map with the render

   The studio's joints are the URDF's radians. The arm reports LeRobot's
   calibrated degrees, whose zero is the midpoint of the range swept during
   calibration -- a pose with no relationship to the URDF's zero. So

       urdf_deg = sign * reported_deg + offset

   and both terms have to be measured. The offset because the two zeros are
   unrelated; the sign because whether a servo's positive direction matches
   the URDF's joint axis depends on how it is physically mounted, which no
   amount of reading either codebase reveals.

   Fitting those from poses matched by eye does not work -- a tight fit to a
   mis-judged pose looks exactly like a good answer. So the render is the
   instrument instead: mirror mode drives the on-screen arm from the real
   arm's reported joints, and you drag each offset until the picture matches
   the hardware in front of you. Picture compared to arm, no algebra between.
   ========================================================================= */
const LABEL = {
  shoulder_pan: "J1 Pan", shoulder_lift: "J2 Lift", elbow_flex: "J3 Elbow",
  wrist_flex: "J4 W-Flex", wrist_roll: "J5 W-Roll"
};
const DEG = Math.PI / 180;

const el = (id) => document.getElementById(id);


// Each arm has its own map; `arm` says which one the tool is measuring.
export const twin = {
  arm: "follower",
  mirror: false,
  present: null,
  map: identityMap()
};

/* Poses the on-screen arm from what the hardware reports. */
export function applyMirrorPose() {
  if (!twin.present) return false;
  const q = armToUrdf(twin.map, twin.present);
  applyPose(
    { shoulder_pan: q[0], shoulder_lift: q[1], elbow_flex: q[2], wrist_flex: q[3], gripper: q[5] },
    q[4]
  );
  return true;
}

function paint() {
  const sim = twin.present ? armToUrdf(twin.map, twin.present) : null;
  BODY.forEach((j, i) => {
    const m = twin.map[j];
    const signBtn = el(`twin-sign-${j}`);
    const slider = el(`twin-offset-${j}`);
    const readout = el(`twin-read-${j}`);
    if (!signBtn) return;
    signBtn.textContent = m.sign > 0 ? "+" : "−";
    signBtn.className = m.sign > 0
      ? "w-6 h-6 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono"
      : "w-6 h-6 rounded bg-amber-900/70 border border-amber-600 text-amber-200 font-mono";
    slider.value = m.offset_deg;
    const reported = twin.present ? twin.present[j] : null;
    readout.textContent = reported === null || reported === undefined
      ? `${m.offset_deg.toFixed(1)}°`
      : `${m.offset_deg.toFixed(1)}° · arm ${reported.toFixed(1)}° → sim ${(sim[i] / DEG).toFixed(1)}°`;
  });
  const g = el("twin-gripper-read");
  if (g) g.textContent = twin.present ? `${(twin.present.gripper ?? 0).toFixed(0)}%` : "--";
}

let presentTimer = null;

function hint(text, tone = "slate") {
  const h = el("twin-hint");
  h.textContent = text;
  h.className = `text-[10px] leading-snug text-${tone}-${tone === "slate" ? "500" : "400"}`;
}

function setMirror(on) {
  // Mirroring needs a live driver on the other end. Refuse loudly rather than
  // toggling a button that then does nothing: every failure here is silent
  // otherwise, because the render simply carries on running off the IK.
  if (on && !sendCommand({ cmd: "telemetry", on: true, arm: twin.arm })) {
    hint("Bridge is not linked. Press Bridge in the header first, then mirror.", "amber");
    return;
  }
  if (!on) sendCommand({ cmd: "telemetry", on: false, arm: twin.arm });

  twin.mirror = on;
  setMirroring(on);
  if (on) setRelaxed(true, twin.arm); // never mirror a powered arm you are posing by hand

  clearTimeout(presentTimer);
  if (on) {
    twin.present = null;
    presentTimer = setTimeout(() => {
      if (twin.mirror && !twin.present) {
        hint(`No telemetry arriving from the ${twin.arm}. Check ${twin.arm === "leader" ? "LEADER_PORT" : "ARM_PORT"} is set, and watch the bridge console.`, "amber");
      }
    }, 2500);
  }
  const btn = el("btn-twin-mirror");
  btn.className = on
    ? "flex-1 py-1.5 rounded-md bg-cyan-900/80 border border-cyan-600 text-cyan-200 text-xs font-mono transition"
    : "flex-1 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-mono transition";
  el("twin-mirror-label").textContent = on ? "Mirroring Real Arm" : "Mirror Real Arm";
  hint(on
    ? "Waiting for the first reading from the arm..."
    : "Link the bridge, then mirror to measure the joint map against the real arm.");
}

async function save() {
  const note = el("twin-save-note");
  try {
    const res = await fetch(`/api/joint-map?arm=${twin.arm}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(twin.map)
    });
    const body = await res.json();
    note.textContent = res.ok ? "Saved · restart the bridge" : `Rejected: ${body.error}`;
    note.className = res.ok ? "text-[10px] font-mono text-emerald-400" : "text-[10px] font-mono text-rose-400";
  } catch (err) {
    note.textContent = `Save failed: ${err.message}`;
    note.className = "text-[10px] font-mono text-rose-400";
  }
}

// Start from whatever is already on disk, so tuning continues rather than
// restarting from identity every session.
function loadMap(arm) {
  twin.map = identityMap();
  paint();
  fetch(`/api/joint-map?arm=${arm}`)
    .then((r) => r.json())
    .then((saved) => {
      if (!saved || twin.arm !== arm) return;
      for (const j of BODY) if (saved[j]) twin.map[j] = { ...twin.map[j], ...saved[j] };
      if (saved.gripper) twin.map.gripper = { ...twin.map.gripper, ...saved.gripper };
      paint();
    })
    .catch(() => { /* bridge not running; identity map is fine for the sim */ });
}

function selectArm(arm) {
  if (arm === twin.arm) return;
  if (twin.mirror) setMirror(false);
  twin.arm = arm;
  twin.present = null;
  for (const b of document.querySelectorAll("#twin-arm-select [data-arm]")) {
    const on = b.dataset.arm === arm;
    b.className = on ? "flex-1 py-1 rounded-md bg-cyan-600 text-white" : "flex-1 py-1 rounded-md text-slate-300";
  }
  el("twin-save-note").textContent = "";
  loadMap(arm);
}

export function initArmTwin() {
  loadMap(twin.arm);
  for (const b of document.querySelectorAll("#twin-arm-select [data-arm]")) {
    b.addEventListener("click", () => selectArm(b.dataset.arm));
  }

  for (const j of BODY) {
    el(`twin-sign-${j}`).addEventListener("click", () => {
      twin.map[j].sign *= -1;
      paint();
    });
    el(`twin-offset-${j}`).addEventListener("input", (ev) => {
      twin.map[j].offset_deg = parseFloat(ev.target.value);
      paint();
    });
  }
  el("btn-twin-mirror").addEventListener("click", () => setMirror(!twin.mirror));
  el("btn-twin-save").addEventListener("click", save);
  el("btn-twin-zero").addEventListener("click", () => {
    // Zeroing means "the arm is in the URDF zero pose right now": whatever it
    // reports becomes the offset for every joint at once.
    if (!twin.present) return;
    for (const j of BODY) twin.map[j].offset_deg = twin.present[j] ?? 0;
    paint();
  });

  onBridgeMessage((msg) => {
    // Driver frames carry the arm they came from; only the selected one counts.
    if (msg.arm && msg.arm !== twin.arm) return;
    if (msg.type === "present") {
      const first = !twin.present;
      twin.present = msg.pos;
      if (first && twin.mirror) {
        clearTimeout(presentTimer);
        hint("Torque is off. Pose the arm by hand, then drag each offset until the render matches it. Check three poses: folded, forearm level, arm upright.");
      }
      paint();
    } else if (msg.type === "log" && twin.mirror && /telemetry|dry run/i.test(msg.msg || "")) {
      hint(msg.msg, "amber");
    } else if (msg.type === "ready" && msg.present) {
      twin.present = msg.present;
      paint();
    }
  });

  paint();
}

export { BODY as TWIN_JOINTS, LABEL as TWIN_LABELS };
