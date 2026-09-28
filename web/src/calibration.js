import { WIZARD_STEPS, DEFAULT_TABLE_CORNERS, DEFAULT_HOVER_CORNERS } from "./config.js";
import { state } from "./state.js";
import { saveCalibration, loadCalibration, clearCalibration } from "./persist.js";

/* =========================================================================
   CALIBRATION WIZARD & BUTTON EVENT BINDINGS
   ========================================================================= */
const el = (id) => document.getElementById(id);

export function updateWizardUI() {
  const calibration = state.calibration;
  const step = WIZARD_STEPS[calibration.wizardStep];
  const isTable = calibration.activeTab === "table";

  el("calib-guide-title").textContent = isTable ? "Calibrate Table Surface (Min)" : "Calibrate Hover Ceiling (Max)";
  el("calib-guide-step").textContent = `Point ${calibration.wizardStep + 1} of 4: ${step.name}`;
  el("calib-guide-desc").innerHTML = isTable
    ? `Place hand <strong>flat on table</strong> at <strong>${step.name}</strong> and tap Capture.`
    : `Hover hand at <strong>max high ceiling</strong> at <strong>${step.name}</strong> and tap Capture.`;

  // Update corner button styles
  ["tl", "tr", "br", "bl"].forEach((cid, i) => {
    const btn = el(`btn-corner-${cid}`);
    const dot = el(`dot-${cid}`);
    const target = isTable ? calibration.tableCorners[cid] : calibration.hoverCorners[cid];

    el(`status-${cid}`).textContent = `U: ${target.u.toFixed(2)}, V: ${target.v.toFixed(2)}`;

    if (i === calibration.wizardStep) {
      btn.className = "p-2 rounded bg-amber-950/60 border border-amber-500 text-left transition flex justify-between items-center";
      dot.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
    } else {
      btn.className = "p-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition flex justify-between items-center";
      dot.className = isTable ? "w-2 h-2 rounded-full bg-emerald-400" : "w-2 h-2 rounded-full bg-cyan-400";
    }
  });
}

function captureCorner(cornerId) {
  const targetDict = state.calibration.activeTab === "table"
    ? state.calibration.tableCorners
    : state.calibration.hoverCorners;

  targetDict[cornerId] = {
    u: state.currentLivePalmCenter.u,
    v: state.currentLivePalmCenter.v,
    scale: state.currentLiveRigidPalm
  };
}

/* Flashes the header note so a capture visibly lands in storage. */
function noteSaved(text) {
  const note = el("calib-save-note");
  if (!note) return;
  note.textContent = text;
  note.classList.remove("opacity-0");
  clearTimeout(noteSaved.timer);
  noteSaved.timer = setTimeout(() => note.classList.add("opacity-0"), 1800);
}

function persist() {
  noteSaved(saveCalibration() ? "Saved" : "Save unavailable");
}

export function initCalibration() {
  const videoElement = el("webcam-video");

  // Restore the previous session's rig calibration before anything paints.
  const restored = loadCalibration();
  const calibTabTable = el("calib-tab-table");
  const calibTabHover = el("calib-tab-hover");

  calibTabTable.addEventListener("click", () => {
    state.calibration.activeTab = "table";
    calibTabTable.className = "flex-1 py-1.5 rounded-md bg-emerald-900/80 border border-emerald-700 text-emerald-300 flex items-center justify-center gap-1";
    calibTabHover.className = "flex-1 py-1.5 rounded-md text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1";
    updateWizardUI();
  });

  calibTabHover.addEventListener("click", () => {
    state.calibration.activeTab = "hover";
    calibTabHover.className = "flex-1 py-1.5 rounded-md bg-cyan-900/80 border border-cyan-700 text-cyan-300 flex items-center justify-center gap-1";
    calibTabTable.className = "flex-1 py-1.5 rounded-md text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1";
    updateWizardUI();
  });

  // Capture Active Corner (advances the wizard)
  el("btn-capture-active-corner").addEventListener("click", () => {
    captureCorner(WIZARD_STEPS[state.calibration.wizardStep].id);
    state.calibration.wizardStep = (state.calibration.wizardStep + 1) % 4;
    updateWizardUI();
    persist();
  });

  // Direct Corner Override Buttons
  ["tl", "tr", "br", "bl"].forEach((cid, idx) => {
    el(`btn-corner-${cid}`).addEventListener("click", () => {
      state.calibration.wizardStep = idx;
      captureCorner(cid);
      updateWizardUI();
      persist();
    });
  });

  // Reset Calibration to Standard Default Square
  el("btn-reset-calibration").addEventListener("click", () => {
    state.calibration.tableCorners = DEFAULT_TABLE_CORNERS();
    state.calibration.hoverCorners = DEFAULT_HOVER_CORNERS();
    state.calibration.wizardStep = 0;
    updateWizardUI();
    // Reset means reset: drop the stored copy too, or the next reload would
    // quietly bring the old corners back.
    clearCalibration();
    noteSaved("Reset");
  });

  // Inversions and Mirror
  const btnMirror = el("btn-toggle-mirror");
  const btnInvX = el("btn-toggle-inv-x");
  const btnInvZ = el("btn-toggle-inv-z");

  // Paint the three toggles from state rather than trusting the markup, so
  // the defaults in state.js are the single source of truth for them.
  const paintToggles = () => {
    el("label-mirror-status").textContent = state.isVideoMirrored ? "ON" : "OFF";
    videoElement.classList.toggle("-scale-x-100", state.isVideoMirrored);

    el("label-inv-x").textContent = state.isInvertX ? "ON" : "OFF";
    btnInvX.className = state.isInvertX
      ? "py-1 px-2 rounded bg-blue-900/60 border border-blue-600 text-blue-200 flex items-center justify-center gap-1 transition"
      : "py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center gap-1 transition";

    el("label-inv-z").textContent = state.isInvertZ ? "ON" : "OFF";
    btnInvZ.className = state.isInvertZ
      ? "py-1 px-2 rounded bg-purple-900/60 border border-purple-600 text-purple-200 flex items-center justify-center gap-1 transition"
      : "py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center gap-1 transition";
  };

  btnMirror.addEventListener("click", () => {
    state.isVideoMirrored = !state.isVideoMirrored;
    paintToggles();
    persist();
  });

  btnInvX.addEventListener("click", () => {
    state.isInvertX = !state.isInvertX;
    paintToggles();
    persist();
  });

  btnInvZ.addEventListener("click", () => {
    state.isInvertZ = !state.isInvertZ;
    paintToggles();
    persist();
  });

  paintToggles();

  updateWizardUI();
  if (restored) noteSaved("Restored");
}
