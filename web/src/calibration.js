import { WIZARD_STEPS, DEFAULT_TABLE_CORNERS, DEFAULT_HOVER_CORNERS } from "./config.js";
import { state } from "./state.js";
import { saveCalibration, loadCalibration, clearCalibration } from "./persist.js";
import { setStepStatus } from "./settingsSteps.js";

/* =========================================================================
   CALIBRATION WIZARD & BUTTON EVENT BINDINGS
   ========================================================================= */
const el = (id) => document.getElementById(id);

// Plain names for the corners, as someone standing at the table sees them.
const CORNER_NAME = { tl: "far left", tr: "far right", br: "near right", bl: "near left" };

export function updateWizardUI() {
  const calibration = state.calibration;
  const step = WIZARD_STEPS[calibration.wizardStep];
  const isTable = calibration.activeTab === "table";

  el("calib-guide-title").textContent = isTable ? "Table surface" : "Hover height";
  el("calib-guide-step").textContent = `Corner ${calibration.wizardStep + 1} of 4`;
  el("calib-guide-desc").textContent = isTable
    ? `Lay your hand flat on the table at the ${CORNER_NAME[step.id]} corner, then capture.`
    : `Hold your hand at the highest it should reach, over the ${CORNER_NAME[step.id]} corner, then capture.`;

  ["tl", "tr", "br", "bl"].forEach((cid, i) => {
    const target = isTable ? calibration.tableCorners[cid] : calibration.hoverCorners[cid];
    el(`status-${cid}`).textContent = `u ${target.u.toFixed(2)}, v ${target.v.toFixed(2)}`;
    el(`btn-corner-${cid}`).toggleAttribute("data-next", i === calibration.wizardStep);
    el(`dot-${cid}`).dataset.tone = i === calibration.wizardStep ? "warn" : "ok";
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
  const ok = saveCalibration();
  noteSaved(ok ? "Saved" : "Could not save");
  if (ok) setStepStatus("table", "Saved");
}

export function initCalibration() {
  const videoElement = el("webcam-video");

  // Restore the previous session's rig calibration before anything paints.
  const restored = loadCalibration();
  const calibTabTable = el("calib-tab-table");
  const calibTabHover = el("calib-tab-hover");

  const selectTab = (tab) => {
    state.calibration.activeTab = tab;
    calibTabTable.classList.toggle("is-on", tab === "table");
    calibTabHover.classList.toggle("is-on", tab === "hover");
    updateWizardUI();
  };
  calibTabTable.addEventListener("click", () => selectTab("table"));
  calibTabHover.addEventListener("click", () => selectTab("hover"));

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
    setStepStatus("table", "Default corners", "warn");
  });

  // Inversions and Mirror
  const btnMirror = el("btn-toggle-mirror");
  const btnInvX = el("btn-toggle-inv-x");
  const btnInvZ = el("btn-toggle-inv-z");

  // Paint the three toggles from state rather than trusting the markup, so
  // the defaults in state.js are the single source of truth for them.
  const paintToggles = () => {
    btnMirror.setAttribute("aria-pressed", String(state.isVideoMirrored));
    videoElement.classList.toggle("-scale-x-100", state.isVideoMirrored);
    btnInvX.setAttribute("aria-pressed", String(state.isInvertX));
    btnInvZ.setAttribute("aria-pressed", String(state.isInvertZ));
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
  setStepStatus("table", restored ? "Saved" : "Default corners", restored ? "off" : "warn");
}
