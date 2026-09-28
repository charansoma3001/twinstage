import { apiFetch } from "./bridge.js";
import { IS_DEMO } from "./config.js";
import { onBridgeMessage, sendCommand, setMirroring, setRelaxed } from "./robotLink.js";
import { applyPose } from "./robot.js";
import { BODY_JOINTS as BODY } from "./so101.js";
import { armToUrdf, identityMap } from "./jointMap.js";
import { setStepStatus } from "./settingsSteps.js";

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
  shoulder_pan: "Pan", shoulder_lift: "Lift", elbow_flex: "Elbow",
  wrist_flex: "Wrist flex", wrist_roll: "Wrist roll"
};
const DEG = Math.PI / 180;

const el = (id) => document.getElementById(id);

/* One row per joint: name, direction, what the arm reads, offset slider. */
function buildRows() {
  el("twin-rows").innerHTML = BODY.map((j) => `
    <div class="twin-row">
      <span>${LABEL[j]}</span>
      <button id="twin-sign-${j}" class="sign" title="Flip this joint's direction">+</button>
      <span id="twin-read-${j}" class="reading">0.0°</span>
      <input type="range" id="twin-offset-${j}" class="range" min="-180" max="180" step="0.5" value="0" aria-label="${LABEL[j]} offset">
    </div>`).join("");
}

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
    signBtn.toggleAttribute("data-flipped", m.sign < 0);
    slider.value = m.offset_deg;
    const reported = twin.present ? twin.present[j] : null;
    readout.textContent = reported === null || reported === undefined
      ? `${m.offset_deg.toFixed(1)}°`
      : `offset ${m.offset_deg.toFixed(1)}°, arm ${reported.toFixed(1)}° is model ${(sim[i] / DEG).toFixed(1)}°`;
  });
  const g = el("twin-gripper-read");
  if (g) g.textContent = twin.present ? `${(twin.present.gripper ?? 0).toFixed(0)}%` : "--";
}

let presentTimer = null;

function hint(text, tone = "") {
  const h = el("twin-hint");
  h.textContent = text;
  h.dataset.tone = tone;
}

function setMirror(on) {
  // Mirroring needs a live driver on the other end. Refuse loudly rather than
  // toggling a button that then does nothing: every failure here is silent
  // otherwise, because the render simply carries on running off the IK.
  if (on && !sendCommand({ cmd: "telemetry", on: true, arm: twin.arm })) {
    hint("The bridge is not linked. Link it at the top right, then mirror.", "warn");
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
        hint(`No readings are arriving from the ${twin.arm}. Check ${twin.arm === "leader" ? "LEADER_PORT" : "ARM_PORT"} is set, and watch the bridge's terminal.`, "warn");
      }
    }, 2500);
  }
  el("btn-twin-mirror").setAttribute("aria-pressed", String(on));
  el("twin-mirror-label").textContent = on ? "Mirroring the real arm" : "Mirror the real arm";
  hint(on
    ? "Waiting for the first reading from the arm."
    : "Link the bridge, then mirror to measure the joint map against the real arm.");
}

async function save() {
  const note = el("twin-save-note");
  try {
    const res = await apiFetch(`api/joint-map?arm=${twin.arm}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(twin.map)
    });
    const body = await res.json();
    const reload = IS_DEMO ? "Reload the page to load it." : "Restart the bridge to load it.";
    note.textContent = res.ok ? `Saved. ${reload}` : `Not saved: ${body.error}`;
    note.dataset.tone = res.ok ? "ok" : "bad";
    if (res.ok) checkMaps();
  } catch (err) {
    note.textContent = `Not saved: ${err.message}`;
    note.dataset.tone = "bad";
  }
}

// Start from whatever is already on disk, so tuning continues rather than
// restarting from identity every session.
function loadMap(arm) {
  twin.map = identityMap();
  paint();
  apiFetch(`api/joint-map?arm=${arm}`)
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
    b.classList.toggle("is-on", b.dataset.arm === arm);
  }
  el("twin-save-note").textContent = "";
  loadMap(arm);
}

/* The step's status: are both arms' maps on disk? Asks the bridge. */
async function checkMaps() {
  try {
    const [follower, leader] = await Promise.all(["follower", "leader"].map(async (arm) => {
      const res = await apiFetch(`api/joint-map?arm=${arm}`);
      if (!res.ok) throw new Error(res.statusText);
      return !!(await res.json());
    }));
    if (follower && leader) setStepStatus("joint-map", "Both measured");
    else if (follower || leader) setStepStatus("joint-map", `${follower ? "Leader" : "Follower"} not measured`, "warn");
    else setStepStatus("joint-map", "Not measured", "warn");
  } catch {
    setStepStatus("joint-map", "Needs the bridge", "off");
  }
}

export function initArmTwin() {
  buildRows();
  checkMaps();
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
      hint(msg.msg, "warn");
    } else if (msg.type === "ready" && msg.present) {
      twin.present = msg.present;
      paint();
    }
  });

  paint();
}

