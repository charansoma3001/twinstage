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

const MODE_BUTTONS = { interactive: el("mode-interactive"), webcam: el("mode-webcam"), demo: el("mode-demo") };
const syntheticPlaceholder = el("synthetic-placeholder");

/* The sandbox's status tag: what is driving the twin right now. */
export function setTracking(text, tone = "off") {
  const tag = el("tracking-status");
  tag.textContent = text;
  tag.dataset.tone = tone;
}

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
  for (const [m, b] of Object.entries(MODE_BUTTONS)) b.classList.toggle("is-on", m === mode);

  if (mode === "interactive") {
    setTracking("Sliders");
    videoElement.classList.add("hidden");
    syntheticPlaceholder.classList.remove("hidden");
  } else if (mode === "webcam") {
    setTracking("Camera: looking for a hand", "warn");
    syntheticPlaceholder.classList.add("hidden");
    videoElement.classList.remove("hidden");
    videoElement.classList.toggle("-scale-x-100", state.isVideoMirrored);
    await startWebcam();
  } else if (mode === "demo") {
    setTracking("Demo loop", "dry");
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
/* One row per joint in the stage's style: a marker along the joint's range. */
const JOINT_LABEL = ["Pan", "Lift", "Elbow", "W-Flex", "W-Roll", "Grip"];

export function buildServoCards() {
  const box = el("servos-container");
  box.innerHTML = JOINT_LABEL.map((name, idx) => `
    <div class="joint-row" style="color: var(--ember)">
      <span>${name}</span>
      <span class="bar"><i id="servo-bar-${idx}" style="left: 50%"></i></span>
      <b id="servo-raw-${idx}">0°</b>
    </div>`).join("");
}

export function updateTelemetry(joints) {
  joints.forEach((rad, idx) => {
    const limit = CONFIG.limits[idx];
    const norm = (rad - limit.min) / (limit.max - limit.min);
    const raw = el(`servo-raw-${idx}`);
    const bar = el(`servo-bar-${idx}`);
    if (raw) raw.textContent = idx === 5 ? `${Math.round((rad / limit.max) * 100)}%` : `${Math.round(rad * 180 / Math.PI)}°`;
    if (bar) bar.style.left = `${Math.max(0, Math.min(100, norm * 100))}%`;
  });
}

export function initUI() {
  [sliderX, sliderY, sliderZ, sliderPitch, sliderRoll, sliderGripper].forEach(s => {
    s.addEventListener("input", updateFromSliders);
  });

  el("btn-center-target").addEventListener("click", centerTarget);

  for (const [m, b] of Object.entries(MODE_BUTTONS)) b.addEventListener("click", () => setMode(m));

  buildServoCards();
}
