import { HAND_CONNECTIONS } from "./config.js";
import { state } from "./state.js";
import { processOverheadLandmarks } from "./retarget.js";
import { sliderPitch, sliderRoll, syncSlidersAndLabels, setMode, setTracking } from "./ui.js";
import { loadPrefs, openCamera } from "./prefs.js";
import { createHandTracker } from "./handTracker.js";

/* Hand landmarks come from the shared tracker (MediaPipe Tasks, bundled with
   the app), the same one the stage uses, so a calibration captured here
   measures palms exactly as the stage will read them. The model is loaded at
   start-up so the first Live Camera click does not wait for it. */
let tracker = null;
function ensureTracker() {
  if (!tracker) tracker = createHandTracker({ numHands: 1, onResults: onHandResults });
  return tracker;
}

/* Replaces the placeholder with a readable failure instead of bouncing the
   user back to Interactive with no explanation. */
function showCameraError(err) {
  const box = document.getElementById("synthetic-placeholder");
  const detail = (err && err.message) || String(err);
  const denied = /denied|dismissed|NotAllowed/i.test(detail);
  box.innerHTML = `
    <p class="font-medium">${denied ? "Camera access is blocked" : "The camera did not start"}</p>
    <p class="note mt-1" data-tone="bad">${detail}</p>
    <p class="note mt-1">${denied
      ? "Allow the camera for this site from the address bar, then start it again."
      : "The hand model failed to load. Reload the page and start the camera again."}</p>`;
  box.classList.remove("hidden");
}

function clearCameraError() {
  const box = document.getElementById("synthetic-placeholder");
  if (box.dataset.original) box.innerHTML = box.dataset.original;
  bindStart();
}

/* The placeholder's own Start button; rebound whenever its markup is restored. */
function bindStart() {
  document.getElementById("btn-start-camera")?.addEventListener("click", () => setMode("webcam"));
}

const videoElement = document.getElementById("webcam-video");
const canvasElement = document.getElementById("hand-canvas");
const canvasCtx = canvasElement.getContext("2d");
const camLoading = document.getElementById("cam-loading");

let cameraInstance = null;

export function resizeCanvas() {
  if (canvasElement && canvasElement.parentElement) {
    canvasElement.width = canvasElement.parentElement.clientWidth;
    canvasElement.height = canvasElement.parentElement.clientHeight;
  }
}

export function onHandResults(results) {
  if (state.currentMode !== "webcam") return;

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // Draw Calibrated 4-Corner Workspace Grid & Handles
  drawCalibrationOverlays(canvasCtx, canvasElement.width, canvasElement.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    drawHandSkeleton(canvasCtx, landmarks, canvasElement.width, canvasElement.height);

    const retargeted = processOverheadLandmarks(landmarks);
    state.targetCartesian = retargeted.cartesian;

    syncSlidersAndLabels();

    // Update Gauges
    document.getElementById("gauge-height-bar").style.width = `${retargeted.heightGaugePct}%`;
    document.getElementById("gauge-height-pct").textContent = `${retargeted.heightGaugePct}%`;
    document.getElementById("label-live-palm").textContent = (state.currentLiveRigidPalm * 100).toFixed(1);

    // The bar is the commanded aperture; the label carries the raw thumb angle
    // behind it, which is what you tune the mapping against.
    const pinchPct = Math.round(retargeted.pinch * 100);
    document.getElementById("metric-pinch-bar").style.width = `${pinchPct}%`;
    document.getElementById("metric-pinch-val").textContent =
      `${retargeted.pinch.toFixed(2)} at ${Math.round(retargeted.thumbSpread)}°`;
    document.getElementById("val-pitch").textContent = `${sliderPitch.value}°`;
    document.getElementById("val-roll").textContent = `${sliderRoll.value}°`;

    setTracking("Camera: tracking a hand", "ok");
  } else {
    setTracking("Camera: looking for a hand", "warn");
  }
  canvasCtx.restore();
}

export function drawCalibrationOverlays(ctx, w, h) {
  const tc = state.calibration.tableCorners;
  const hc = state.calibration.hoverCorners;

  // 1. Draw Hover Quad (Cyan dashed)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(hc.tl.u * w, hc.tl.v * h);
  ctx.lineTo(hc.tr.u * w, hc.tr.v * h);
  ctx.lineTo(hc.br.u * w, hc.br.v * h);
  ctx.lineTo(hc.bl.u * w, hc.bl.v * h);
  ctx.closePath();
  ctx.stroke();

  // 2. Draw Table Quad & Interior Grid Mesh (Emerald solid)
  ctx.strokeStyle = "rgba(254, 94, 14, 0.9)";
  ctx.fillStyle = "rgba(254, 94, 14, 0.06)";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tc.tl.u * w, tc.tl.v * h);
  ctx.lineTo(tc.tr.u * w, tc.tr.v * h);
  ctx.lineTo(tc.br.u * w, tc.br.v * h);
  ctx.lineTo(tc.bl.u * w, tc.bl.v * h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Interior 3x3 Table Grid
  ctx.strokeStyle = "rgba(254, 94, 14, 0.3)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    const f = i / 3.0;
    // Horizontal lines
    const lx1 = (1 - f) * tc.tl.u + f * tc.bl.u;
    const ly1 = (1 - f) * tc.tl.v + f * tc.bl.v;
    const rx1 = (1 - f) * tc.tr.u + f * tc.br.u;
    const ry1 = (1 - f) * tc.tr.v + f * tc.br.v;
    ctx.beginPath();
    ctx.moveTo(lx1 * w, ly1 * h);
    ctx.lineTo(rx1 * w, ry1 * h);
    ctx.stroke();

    // Vertical lines
    const tx1 = (1 - f) * tc.tl.u + f * tc.tr.u;
    const ty1 = (1 - f) * tc.tl.v + f * tc.tr.v;
    const bx1 = (1 - f) * tc.bl.u + f * tc.br.u;
    const by1 = (1 - f) * tc.bl.v + f * tc.br.v;
    ctx.beginPath();
    ctx.moveTo(tx1 * w, ty1 * h);
    ctx.lineTo(bx1 * w, by1 * h);
    ctx.stroke();
  }

  // 3. Draw Corner Handles & Labels
  const corners = [
    { id: "tl", name: "TL (Far-L)", pt: tc.tl },
    { id: "tr", name: "TR (Far-R)", pt: tc.tr },
    { id: "br", name: "BR (Near-R)", pt: tc.br },
    { id: "bl", name: "BL (Near-L)", pt: tc.bl }
  ];

  corners.forEach((c, idx) => {
    const isCurrentStep = state.calibration.wizardStep === idx;
    ctx.beginPath();
    ctx.arc(c.pt.u * w, c.pt.v * h, isCurrentStep ? 8 : 5, 0, 2 * Math.PI);
    ctx.fillStyle = isCurrentStep ? "#febe42" : "#fe5e0e";
    ctx.fill();
    ctx.strokeStyle = "#000b1a";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = isCurrentStep ? "#febe42" : "rgba(255, 255, 255, 0.9)";
    ctx.font = isCurrentStep ? "bold 10px monospace" : "9px monospace";
    ctx.fillText(c.name, c.pt.u * w + 8, c.pt.v * h - 4);
  });
}

export function drawHandSkeleton(ctx, landmarks, w, h) {
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";

  for (const [s, e] of HAND_CONNECTIONS) {
    let p1x = landmarks[s].x * w;
    let p2x = landmarks[e].x * w;
    if (state.isVideoMirrored) {
      p1x = (1.0 - landmarks[s].x) * w;
      p2x = (1.0 - landmarks[e].x) * w;
    }
    ctx.beginPath();
    ctx.moveTo(p1x, landmarks[s].y * h);
    ctx.lineTo(p2x, landmarks[e].y * h);
    ctx.stroke();
  }

  for (let i = 0; i < landmarks.length; i++) {
    let px = landmarks[i].x * w;
    if (state.isVideoMirrored) px = (1.0 - landmarks[i].x) * w;
    ctx.beginPath();
    ctx.arc(px, landmarks[i].y * h, i === 4 || i === 8 ? 5.5 : 3, 0, 2 * Math.PI);
    ctx.fillStyle = i === 4 || i === 8 ? "#febe42" : "#fe5e0e";
    ctx.fill();
    ctx.strokeStyle = "#000b1a";
    ctx.stroke();
  }
}

export async function startWebcam() {
  if (state.isWebcamRunning) return;
  clearCameraError();
  camLoading.classList.remove("hidden");
  try {
    await ensureTracker().ready;

    // The chosen hand camera, not whichever the browser picks: the stage rig
    // has two.
    const stream = await openCamera(loadPrefs().handsCameraId, { width: 640, height: 480 });
    videoElement.srcObject = stream;
    await videoElement.play();
    let running = true;
    const pump = async () => {
      if (!running) return;
      if (state.currentMode === "webcam") tracker.send(videoElement);
      requestAnimationFrame(pump);
    };
    cameraInstance = {
      stop() {
        running = false;
        stream.getTracks().forEach((t) => t.stop());
      }
    };
    requestAnimationFrame(pump);
    state.isWebcamRunning = true;
    camLoading.classList.add("hidden");
  } catch (err) {
    console.warn("Camera start failed:", err);
    camLoading.classList.add("hidden");
    cameraInstance = null;
    showCameraError(err);
    setMode("interactive");
  }
}

export function stopWebcam() {
  if (cameraInstance) cameraInstance.stop();
  state.isWebcamRunning = false;
}

export function initTracking() {
  const box = document.getElementById("synthetic-placeholder");
  box.dataset.original = box.innerHTML;
  bindStart();
  resizeCanvas();
  ensureTracker().ready.catch((err) => console.warn("Hand model failed to load:", err));
}
