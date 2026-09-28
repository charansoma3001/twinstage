import "../ui/theme.css";
import "./stage.css";
import { loadCalibration } from "../persist.js";
import { savePrefs, onPrefsChange, openCamera } from "../prefs.js";
import * as twin from "./twin.js";
import { startHands, restartHands, setHandPrefs } from "./hands.js";
import { baseScene, baseCamera, initBaseTwin, setBaseActive, isBaseActive, updateBaseTwin } from "../baseTwin.js";
import { S, ARMS, el, link } from "./state.js";
import { renderer, container, resize } from "./view.js";
import { driveArm } from "./drive.js";
import { buildJointRows, paintCards, paintLive, paintMode, paintPrim, showPresenter } from "./paint.js";
import { onMessage, onLinkDrop, loadMaps } from "./messages.js";
import { showDemoBadge } from "../ui/demoBadge.js";

/* =========================================================================
   STAGE: the big-screen page.

   The bridge owns the mode; this page shows it and asks for changes. In
   hands mode it is also the source of both arms' joints. In every other mode
   the twin shows what the arms report.

   state.js   shared state and the link   drive.js    targets -> joints -> bridge
   view.js    the renderer                paint.js    the DOM around the twin
   messages.js  what the bridge says
   ========================================================================= */

function startPrimitive(name) {
  S.prim = { name, t0: performance.now() };
  if (S.mode !== "primitive") link.send({ cmd: "mode", mode: "primitive" });
  paintPrim();
}

let lastFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 60;
  lastFrame = now;
  if (S.view === "base" && isBaseActive()) {
    updateBaseTwin(dt);
    renderer.render(baseScene, baseCamera);
    return;
  }
  for (const arm of ARMS) driveArm(arm, now, dt);
  twin.frame(renderer);
  paintLive(dt);
}

/* ---------------------------------------------------------------------- */
function setView(view) {
  S.view = view;
  for (const b of document.querySelectorAll("#view-switch [data-view]")) b.classList.toggle("is-on", b.dataset.view === view);
  const base = view === "base";
  for (const [id, show] of [["arm-cards", !base], ["float-cards", !base], ["base-hud", base]]) {
    const node = el(id);
    const was = !node.classList.contains("hidden");
    node.classList.toggle("hidden", !show);
    if (show && !was) {
      node.classList.remove("rise-in");
      void node.offsetWidth;
      node.classList.add("rise-in");
    }
  }
  twin.setEnabled(!base);
  setBaseActive(base);
  paintMode();
}

function stopEverything() {
  link.send({ cmd: "freeze" });
  link.send({ cmd: "base_stop" });
}

// Same breakpoint as the stylesheet's lg: below it the camera cards are not
// shown, so a phone is never asked for its camera.
const wide = matchMedia("(min-width: 1024px)");
let camerasOn = false;

function startCamerasWhenShown() {
  if (wide.matches) {
    camerasOn = true;
    startCameras();
    return;
  }
  wide.addEventListener("change", function grown() {
    if (!wide.matches) return;
    wide.removeEventListener("change", grown);
    startCamerasWhenShown();
  });
}

async function startCameras() {
  setHandPrefs({ leaderSide: S.prefs.leaderSide, flipLabels: S.prefs.flipLabels });
  await startHands(el("hands-video"), el("hands-canvas"), S.prefs.handsCameraId);
  const fv = el("follower-video");
  const ft = el("follower-cam-tag");
  try {
    if (fv.srcObject) fv.srcObject.getTracks().forEach((t) => t.stop());
    fv.srcObject = await openCamera(S.prefs.followerCameraId);
    ft.textContent = "Live";
    ft.dataset.tone = "ok";
    el("follower-error").classList.add("hidden");
  } catch (err) {
    ft.textContent = "No camera";
    ft.dataset.tone = "bad";
    el("follower-error").textContent = err.message;
    el("follower-error").classList.remove("hidden");
  }
}

async function boot() {
  showDemoBadge();
  showPresenter();
  loadCalibration();
  buildJointRows();
  resize();

  for (const b of document.querySelectorAll("#mode-switch [data-mode]")) {
    b.addEventListener("click", () => link.send({ cmd: "mode", mode: b.dataset.mode }));
  }
  for (const b of document.querySelectorAll("#view-switch [data-view]")) {
    b.addEventListener("click", () => setView(b.dataset.view));
  }
  el("btn-stop").addEventListener("click", stopEverything);
  for (const b of document.querySelectorAll("#prim-buttons [data-prim]")) {
    b.addEventListener("click", () => startPrimitive(b.dataset.prim));
  }
  for (const b of document.querySelectorAll("#prim-arms [data-arms]")) {
    b.addEventListener("click", () => {
      S.primArms = b.dataset.arms;
      paintPrim();
    });
  }
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") stopEverything();
  });
  for (const b of document.querySelectorAll("#hands-arms [data-arms]")) {
    b.addEventListener("click", () => {
      S.handsArms = b.dataset.arms;
      setHandPrefs({ onlyFollower: S.handsArms === "follower" });
      for (const x of document.querySelectorAll("#hands-arms [data-arms]")) x.classList.toggle("is-on", x === b);
    });
  }
  el("btn-swap").addEventListener("click", () => {
    S.prefs = savePrefs({ leaderSide: S.prefs.leaderSide === "left" ? "right" : "left" });
    setHandPrefs({ leaderSide: S.prefs.leaderSide });
    twin.setLayout(S.prefs.leaderSide, S.prefs.armSpacingCm / 100);
  });

  // Settings open in another tab: camera, hand and calibration changes land
  // here without a reload.
  onPrefsChange((p) => {
    const camsChanged = p.handsCameraId !== S.prefs.handsCameraId || p.followerCameraId !== S.prefs.followerCameraId;
    S.prefs = p;
    setHandPrefs({ leaderSide: p.leaderSide, flipLabels: p.flipLabels });
    twin.setLayout(p.leaderSide, p.armSpacingCm / 100);
    if (camsChanged && camerasOn) {
      restartHands(p.handsCameraId);
      startCameras();
    }
  });
  window.addEventListener("storage", (ev) => {
    if (ev.key && ev.key.includes(":calibration:")) loadCalibration();
  });

  link.onMessage(onMessage);
  link.onClose(onLinkDrop);
  link.onOpen(() => loadMaps());
  // Before connecting, so the base twin hears the bridge's hello too.
  initBaseTwin({ renderer, container, link });
  link.connect();

  await twin.initTwin(renderer, container, S.prefs.leaderSide, S.prefs.armSpacingCm / 100);
  if (new URLSearchParams(location.search).get("view") === "base") setView("base");
  paintMode();
  setInterval(paintCards, 100);
  requestAnimationFrame(frame);
  startCamerasWhenShown();
}

boot().catch((err) => {
  console.error("Stage failed to start:", err);
  el("stage-title").textContent = "Failed to start";
  el("explain-body").textContent = err.message;
});
