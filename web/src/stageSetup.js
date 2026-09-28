import { loadPrefs, savePrefs, listCameras } from "./prefs.js";
import { setStepStatus } from "./settingsSteps.js";

/* Settings-page controls for the stage rig: camera roles and rotation, and
   hand -> arm. */
const el = (id) => document.getElementById(id);

function fillSelect(select, cams, current) {
  select.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Default camera";
  select.appendChild(none);
  for (const c of cams) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.label;
    select.appendChild(o);
  }
  // A saved camera that is not plugged in stays visible, so it is not
  // silently replaced by whichever camera happens to be first.
  if (current && !cams.some((c) => c.id === current)) {
    const o = document.createElement("option");
    o.value = current;
    o.textContent = "Saved camera (not connected)";
    select.appendChild(o);
  }
  select.value = current;
}

const label = (id, text) => { el(id).querySelector("[data-label]").textContent = text; };

function paintToggles(p) {
  label("btn-leader-side", p.leaderSide === "left" ? "Left hand" : "Right hand");
  label("btn-flip-labels", p.flipLabels ? "Flipped" : "As reported");
  el("btn-flip-labels").setAttribute("aria-pressed", String(p.flipLabels));
  for (const [id, key] of [["btn-rot-hands", "handsCameraRot"], ["btn-rot-follower", "followerCameraRot"]]) {
    label(id, p[key] === 180 ? "Upside down" : "Upright");
    el(id).setAttribute("aria-pressed", String(p[key] === 180));
  }
  // The calibration preview is the hand camera: turned the same way as on the stage.
  for (const id of ["webcam-video", "hand-canvas"]) el(id).classList.toggle("rotate-180", p.handsCameraRot === 180);
}

function paintStatus(p = loadPrefs()) {
  setStepStatus("cameras", p.handsCameraId ? "Chosen" : "Default camera", p.handsCameraId ? "off" : "warn");
  const summary = `The arms are ${p.armSpacingCm} cm apart and stop ${p.minGapCm} cm short of each other. ` +
    `Each may reach ${Math.max(0, (p.armSpacingCm - p.minGapCm) / 2).toFixed(1)} cm toward the other from its base.`;
  el("layout-summary").textContent = summary;
  setStepStatus("layout", `${p.armSpacingCm} cm apart`);
}

async function refresh() {
  const p = loadPrefs();
  let cams = [];
  try {
    cams = await listCameras();
  } catch (err) {
    console.warn("Camera list failed:", err);
  }
  fillSelect(el("sel-cam-hands"), cams, p.handsCameraId);
  fillSelect(el("sel-cam-follower"), cams, p.followerCameraId);
}

export function initStageSetup() {
  el("sel-cam-hands").addEventListener("change", (ev) => paintStatus(savePrefs({ handsCameraId: ev.target.value })));
  el("sel-cam-follower").addEventListener("change", (ev) => savePrefs({ followerCameraId: ev.target.value }));
  el("btn-cam-refresh").addEventListener("click", refresh);
  el("btn-leader-side").addEventListener("click", () => {
    const p = loadPrefs();
    paintToggles(savePrefs({ leaderSide: p.leaderSide === "left" ? "right" : "left" }));
  });
  el("btn-flip-labels").addEventListener("click", () => {
    paintToggles(savePrefs({ flipLabels: !loadPrefs().flipLabels }));
  });
  for (const [id, key] of [["btn-rot-hands", "handsCameraRot"], ["btn-rot-follower", "followerCameraRot"]]) {
    el(id).addEventListener("click", () => paintToggles(savePrefs({ [key]: loadPrefs()[key] === 180 ? 0 : 180 })));
  }
  for (const [id, key] of [["in-arm-spacing", "armSpacingCm"], ["in-min-gap", "minGapCm"]]) {
    const input = el(id);
    input.value = loadPrefs()[key];
    input.addEventListener("change", () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v >= 0) savePrefs({ [key]: v });
      input.value = loadPrefs()[key];
      paintStatus();
    });
  }
  paintToggles(loadPrefs());
  paintStatus();
  refresh();
}
