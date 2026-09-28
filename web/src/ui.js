import { CONFIG } from "./config.js";
import { state } from "./state.js";
import { startWebcam } from "./tracking.js";

/* =========================================================================
   UI SLIDERS & INTERACTIVE MODE OVERRIDES
   ========================================================================= */
export const sliderX = document.getElementById("slider-target-x");
export const sliderY = document.getElementById("slider-target-y");
export const sliderZ = document.getElementById("slider-target-z");
export const sliderPitch = document.getElementById("slider-wrist-pitch");
export const sliderRoll = document.getElementById("slider-wrist-roll");
export const sliderGripper = document.getElementById("slider-gripper");

const el = (id) => document.getElementById(id);

const btnModeInteractive = el("mode-interactive");
const btnModeWebcam = el("mode-webcam");
const btnModeDemo = el("mode-demo");
export const trackingInd = el("tracking-indicator");
export const trackingTxt = el("tracking-status");
const syntheticPlaceholder = el("synthetic-placeholder");

/* Mirrors the current targetCartesian onto the sliders + numeric labels.
   Shared by slider input, webcam retargeting and demo routines. */
export function syncSlidersAndLabels() {
  const t = state.targetCartesian;
  sliderX.value = t.x.toFixed(3);
  sliderY.value = t.y.toFixed(3);
  sliderZ.value = t.z.toFixed(3);
  sliderPitch.value = Math.round(t.pitch * 180 / Math.PI);
  sliderRoll.value = Math.round(t.roll * 180 / Math.PI);
  sliderGripper.value = Math.round(t.gripper * 100);
  syncLabels();
}

export function syncLabels() {
  const t = state.targetCartesian;
  el("label-target-x").textContent = `${t.x.toFixed(3)} m`;
  el("label-target-y").textContent = `${t.y.toFixed(3)} m`;
  el("label-target-z").textContent = `${t.z.toFixed(3)} m`;
  el("label-wrist-pitch").textContent = `${sliderPitch.value}°`;
  el("label-wrist-roll").textContent = `${sliderRoll.value}°`;
  el("label-gripper-stroke").textContent = `${sliderGripper.value}%`;
  el("gauge-height-val").textContent = `${t.y.toFixed(3)} m`;
}

/* Linear height gauge driven by the Y target (interactive + demo modes). */
export function syncHeightGaugeLinear() {
  const t = state.targetCartesian;
  const heightPct = Math.round(((t.y - CONFIG.workspace.yMin) / (CONFIG.workspace.yMax - CONFIG.workspace.yMin)) * 100);
  el("gauge-height-bar").style.width = `${Math.max(0, Math.min(100, heightPct))}%`;
  el("gauge-height-pct").textContent = `${heightPct}%`;
}

export function updateFromSliders() {
  if (state.currentMode !== "interactive") return;
  const t = state.targetCartesian;
  t.x = parseFloat(sliderX.value);
  t.y = parseFloat(sliderY.value);
  t.z = parseFloat(sliderZ.value);
  t.pitch = parseFloat(sliderPitch.value) * Math.PI / 180;
  t.roll = parseFloat(sliderRoll.value) * Math.PI / 180;
  t.gripper = parseFloat(sliderGripper.value) / 100;

  syncLabels();
  el("metric-pinch-bar").style.width = `${sliderGripper.value}%`;
  el("val-pitch").textContent = `${sliderPitch.value}°`;
  el("val-roll").textContent = `${sliderRoll.value}°`;
  syncHeightGaugeLinear();
}

/* =========================================================================
   MODE SWITCHER
   ========================================================================= */
export async function setMode(mode) {
  const videoElement = el("webcam-video");
  state.currentMode = mode;
  state.activeDemoRoutine = null;
  [btnModeInteractive, btnModeWebcam, btnModeDemo].forEach(b => {
    b.className = "px-3 py-1.5 rounded-md font-medium text-slate-300 hover:text-white transition-all flex items-center gap-1.5";
  });

  if (mode === "interactive") {
    btnModeInteractive.className = "px-3 py-1.5 rounded-md font-medium bg-cyan-600 text-white shadow transition-all flex items-center gap-1.5";
    trackingInd.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
    trackingTxt.textContent = "Interactive Mode";
    videoElement.classList.add("hidden");
    syntheticPlaceholder.classList.remove("hidden");
  } else if (mode === "webcam") {
    btnModeWebcam.className = "px-3 py-1.5 rounded-md font-medium bg-cyan-600 text-white shadow transition-all flex items-center gap-1.5";
    trackingInd.className = "w-2 h-2 rounded-full bg-emerald-400";
    trackingTxt.textContent = "4-Corner Spatial Mapping Active";
    syntheticPlaceholder.classList.add("hidden");
    videoElement.classList.remove("hidden");
    if (state.isVideoMirrored) videoElement.classList.add("-scale-x-100");
    await startWebcam();
  } else if (mode === "demo") {
    btnModeDemo.className = "px-3 py-1.5 rounded-md font-medium bg-cyan-600 text-white shadow transition-all flex items-center gap-1.5";
    trackingInd.className = "w-2 h-2 rounded-full bg-cyan-400 animate-pulse";
    trackingTxt.textContent = "Autonomous Routine";
    videoElement.classList.add("hidden");
    syntheticPlaceholder.classList.remove("hidden");
    state.activeDemoRoutine = "pickAndPlace";
    state.demoTime = 0;
  }
}

export function centerTarget() {
  setMode("interactive");
  sliderX.value = "0.0"; sliderY.value = "0.22"; sliderZ.value = "0.24";
  sliderPitch.value = "-90"; sliderRoll.value = "0"; sliderGripper.value = "80";
  updateFromSliders();
}

/* =========================================================================
   TELEMETRY & SERVO STATS
   ========================================================================= */
export function buildServoCards() {
  const servosContainer = el("servos-container");
  CONFIG.limits.forEach((limit, idx) => {
    const card = document.createElement("div");
    card.className = "bg-slate-950 p-2 rounded border border-slate-800 space-y-1";
    card.innerHTML = `
      <div class="flex justify-between items-center text-slate-300">
        <span class="font-bold">${limit.name}</span>
        <span id="servo-raw-${idx}" class="text-cyan-400">0.00°</span>
      </div>
      <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
        <div id="servo-bar-${idx}" class="h-full bg-cyan-500" style="width: 50%;"></div>
      </div>`;
    servosContainer.appendChild(card);
  });
}

export function updateTelemetry(joints) {
  joints.forEach((rad, idx) => {
    const limit = CONFIG.limits[idx];
    const deg = (rad * 180 / Math.PI).toFixed(1);
    const norm = (rad - limit.min) / (limit.max - limit.min);
    const raw = el(`servo-raw-${idx}`);
    const bar = el(`servo-bar-${idx}`);
    if (raw) raw.textContent = `${deg}°`;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, norm * 100))}%`;
  });
}

export function initUI() {
  [sliderX, sliderY, sliderZ, sliderPitch, sliderRoll, sliderGripper].forEach(s => {
    s.addEventListener("input", updateFromSliders);
  });

  el("btn-center-target").addEventListener("click", centerTarget);

  btnModeInteractive.addEventListener("click", () => setMode("interactive"));
  btnModeWebcam.addEventListener("click", () => setMode("webcam"));
  btnModeDemo.addEventListener("click", () => setMode("demo"));

  // Right drawer tabs
  const tabBtnControls = el("tab-btn-controls");
  const tabBtnTelemetry = el("tab-btn-telemetry");
  const tabContentControls = el("tab-content-controls");
  const tabContentTelemetry = el("tab-content-telemetry");

  tabBtnControls.addEventListener("click", () => {
    tabBtnControls.className = "flex-1 py-2.5 border-b-2 border-cyan-500 text-cyan-400 bg-slate-800/40 flex justify-center gap-1.5";
    tabBtnTelemetry.className = "flex-1 py-2.5 border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex justify-center gap-1.5";
    tabContentControls.classList.remove("hidden");
    tabContentTelemetry.classList.add("hidden");
  });

  tabBtnTelemetry.addEventListener("click", () => {
    tabBtnTelemetry.className = "flex-1 py-2.5 border-b-2 border-cyan-500 text-cyan-400 bg-slate-800/40 flex justify-center gap-1.5";
    tabBtnControls.className = "flex-1 py-2.5 border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex justify-center gap-1.5";
    tabContentTelemetry.classList.remove("hidden");
    tabContentControls.classList.add("hidden");
  });

  buildServoCards();
}
