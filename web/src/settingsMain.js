import "./ui/theme.css";
import "./settings.css";
import { state } from "./state.js";
import { solveSO101IK } from "./kinematics.js";
import { controls, renderer, scene, camera, applyToolState, resizeViewport, resetView } from "./scene.js";
import { loadRobot, applyPose, jointValues } from "./robot.js";
import { initUI, updateFromSliders, updateTelemetry, centerTarget } from "./ui.js";
import { initCalibration } from "./calibration.js";
import { initDemos, runDemoRoutine } from "./demo.js";
import { resizeCanvas, initTracking } from "./tracking.js";
import { initRobotLink, streamJoints } from "./robotLink.js";
import { initArmTwin, applyMirrorPose, twin } from "./armTwin.js";
import { initStageSetup } from "./stageSetup.js";
import { initSteps, onStepChange } from "./settingsSteps.js";

/* =========================================================================
   MAIN SIMULATION & ANIMATION LOOP
   ========================================================================= */
let lastTime = performance.now();
let frameCount = 0, fpsTimer = 0;
const fpsEl = document.getElementById("fps-counter");

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  frameCount++; fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fpsEl.textContent = Math.round(frameCount / fpsTimer);
    frameCount = 0; fpsTimer = 0;
  }

  if (state.currentMode === "demo" && state.activeDemoRoutine) {
    state.demoTime += dt;
    runDemoRoutine(state.activeDemoRoutine, state.demoTime);
  }

  // Smooth EMA filtering
  const a = state.emaAlpha;
  const f = state.filteredCartesian;
  const t = state.targetCartesian;
  f.x += a * (t.x - f.x);
  f.y += a * (t.y - f.y);
  f.z += a * (t.z - f.z);
  f.pitch += a * (t.pitch - f.pitch);
  // Roll is a symmetric jaw heading (period 180 deg), so filter along the
  // shortest equivalent arc; a plain EMA would sweep the wrist the long way
  // round whenever the heading folds across +/-90 deg.
  let dRoll = t.roll - f.roll;
  if (dRoll > Math.PI / 2) dRoll -= Math.PI;
  else if (dRoll < -Math.PI / 2) dRoll += Math.PI;
  f.roll += a * dRoll;
  f.gripper += a * (t.gripper - f.gripper);

  // In mirror mode the hardware drives the render, not the other way round:
  // the render is the instrument the joint map is measured with.
  if (!(twin.mirror && applyMirrorPose())) {
    applyPose(solveSO101IK(f), f.roll);
  }
  state.currentJoints = jointValues();

  applyToolState(state.currentJoints);
  updateTelemetry(state.currentJoints);
  streamJoints(state.currentJoints, f, now);

  controls.update();
  renderer.render(scene, camera);
}

async function boot() {
  initSteps();
  await loadRobot(scene);

  initUI();
  initCalibration();
  initDemos();
  initRobotLink();
  initArmTwin();
  initStageSetup();

  document.getElementById("btn-reset-scene").addEventListener("click", () => {
    resetView();
    centerTarget();
  });

  initTracking();
  // The twin's card changes size with the window and the layout; the camera
  // canvas only has a size while its step is open.
  new ResizeObserver(resizeViewport).observe(document.getElementById("canvas-container"));
  window.addEventListener("resize", resizeCanvas);
  onStepChange((step) => { if (step === "table") requestAnimationFrame(resizeCanvas); });

  updateFromSliders();
  animate();
}

boot().catch((err) => {
  console.error("Startup failed:", err);
  const panel = document.querySelector(".panel");
  if (panel) {
    const note = document.createElement("p");
    note.className = "note mt-4";
    note.dataset.tone = "bad";
    note.textContent = `Settings did not start: ${err.message}. Check the browser console, then reload.`;
    panel.prepend(note);
  }
});
