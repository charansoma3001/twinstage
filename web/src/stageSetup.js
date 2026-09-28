import { loadPrefs, savePrefs, listCameras } from "./prefs.js";

/* Settings-page controls for the stage rig: camera roles and hand -> arm. */
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

function paintToggles(p) {
  el("btn-leader-side").textContent = `Leader: ${p.leaderSide} hand`;
  el("btn-flip-labels").textContent = p.flipLabels ? "Hand labels: flipped" : "Hand labels: as reported";
  el("btn-flip-labels").className = p.flipLabels
    ? "py-1.5 rounded bg-amber-900/60 border border-amber-600 text-amber-200 transition"
    : "py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition";
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
  el("sel-cam-hands").addEventListener("change", (ev) => savePrefs({ handsCameraId: ev.target.value }));
  el("sel-cam-follower").addEventListener("change", (ev) => savePrefs({ followerCameraId: ev.target.value }));
  el("btn-cam-refresh").addEventListener("click", refresh);
  el("btn-leader-side").addEventListener("click", () => {
    const p = loadPrefs();
    paintToggles(savePrefs({ leaderSide: p.leaderSide === "left" ? "right" : "left" }));
  });
  el("btn-flip-labels").addEventListener("click", () => {
    paintToggles(savePrefs({ flipLabels: !loadPrefs().flipLabels }));
  });
  for (const [id, key] of [["in-arm-spacing", "armSpacingCm"], ["in-min-gap", "minGapCm"]]) {
    const input = el(id);
    input.value = loadPrefs()[key];
    input.addEventListener("change", () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v >= 0) savePrefs({ [key]: v });
      input.value = loadPrefs()[key];
    });
  }
  paintToggles(loadPrefs());
  refresh();
}
