import "./stage.css";
import * as THREE from "three";
import { CONFIG, PRESENTER } from "../config.js";
import { loadCalibration } from "../persist.js";
import { loadPrefs, savePrefs, onPrefsChange, openCamera } from "../prefs.js";
import { createBridgeLink } from "../bridge.js";
import { armToUrdf } from "../jointMap.js";
import { keepOut, ikJoints, inwardLimit as keepOutLimit } from "./keepout.js";
import * as twin from "./twin.js";
import { hands, fresh, startHands, restartHands, setHandPrefs, setDetecting } from "./hands.js";
import {
  primitiveTarget, mirror, mirrorStation, REST_JOINTS, STATION_A, STATION_B, PICK_CYCLE_S
} from "../primitives.js";
import {
  baseScene, baseCamera, initBaseTwin, setBaseActive, isBaseActive,
  resizeBaseViewport, updateBaseTwin
} from "../baseTwin.js";

/* =========================================================================
   STAGE: the big-screen page.

   The bridge owns the mode; this page shows it and asks for changes. In
   hands mode it is also the source of both arms' joints. In every other mode
   the twin shows what the arms report.
   ========================================================================= */
const ARMS = ["leader", "follower"];
const JOINT_LABEL = ["Pan", "Lift", "Elbow", "W-Flex", "W-Roll", "Grip"];
const GRIPPER_RAD_MAX = CONFIG.limits[5].max;
const DEG = Math.PI / 180;
const SEND_MS = 20;
const EMA = 0.35;

const el = (id) => document.getElementById(id);
// The big screen should never need a click to come back.
const link = createBridgeLink({ reconnectMs: 1000 });

const S = {
  view: "arms",
  mode: "idle",
  modeNote: "",
  pending: null,
  arms: { leader: null, follower: null },          // bridge's view of each driver
  present: { leader: null, follower: null },       // latest LeRobot-unit reading
  maps: { leader: null, follower: null },
  filtered: { leader: null, follower: null },      // EMA'd Cartesian target
  lastSend: { leader: 0, follower: 0 },
  base: null,
  phoneUrls: [],
  prim: null,                                      // { name, t0 } while a primitive runs
  primArms: "both",                                // "leader" | "follower" | "both"
  handsArms: "both",                               // "follower" | "both" in hands mode
  prefs: loadPrefs()
};

/* ---------------------------------------------------------------------- */
const container = el("stage-canvas");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
// The twin and hand tracking share the GPU: drawn at the display's 1.8x the
// twin halved tracking speed (100 ms/frame against 53 at 1x, measured), so it
// drops to 1x while hands are tracked and is sharp again otherwise.
const SHARP_DPR = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(SHARP_DPR);
function setTrackingRender(tracking) {
  const want = tracking ? 1 : SHARP_DPR;
  if (renderer.getPixelRatio() !== want) {
    renderer.setPixelRatio(want);
    resize();
  }
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

function resize() {
  renderer.setSize(container.clientWidth, container.clientHeight);
  twin.resize(container);
  resizeBaseViewport();
}
new ResizeObserver(resize).observe(container);

/* ---------------------------------------------------------------------- */
function toUrdf(arm, pos) {
  return armToUrdf(S.maps[arm] || S.maps.follower, pos);
}


function inwardLimit() {
  return keepOutLimit(S.prefs.armSpacingCm, S.prefs.minGapCm);
}

function filterTarget(arm, t) {
  const f = S.filtered[arm];
  if (!f) {
    S.filtered[arm] = { ...t };
    return S.filtered[arm];
  }
  for (const k of ["x", "y", "z", "pitch", "roll", "gripper"]) f[k] += EMA * (t[k] - f[k]);
  return f;
}

/* ---------------------------------------------------------------------- */
function primRuns(arm) {
  return S.primArms === "both" || S.primArms === arm;
}

// The arm on the operator's left runs the mirror image, so the pair is symmetric.
function isLeftArm(arm) {
  return (arm === "leader") === (S.prefs.leaderSide === "left");
}

function stream(arm, q, now) {
  if (now - S.lastSend[arm] >= SEND_MS) {
    S.lastSend[arm] = now;
    link.send({ joints: q, arm, src: "stage" });
  }
}

function runPrimitive(arm, now) {
  const { name, t0 } = S.prim;
  const left = isLeftArm(arm);
  if (name === "rest") {
    twin.setPose(arm, REST_JOINTS);
    twin.setTarget(arm, null);
    twin.setStations(arm, null);
    S.filtered[arm] = null;
    stream(arm, REST_JOINTS, now);
    return;
  }
  let t = primitiveTarget(name, (now - t0) / 1000);
  if (left) t = mirror(t);
  const cart = filterTarget(arm, keepOut(t, left, inwardLimit()));
  const q = ikJoints(cart);
  twin.setPose(arm, q);
  twin.setTarget(arm, cart);
  twin.setStations(arm, name === "pickAndPlace"
    ? [STATION_A, STATION_B].map((st) => keepOut(left ? mirrorStation(st) : st, left, inwardLimit()))
    : null);
  stream(arm, q, now);
}

function startPrimitive(name) {
  S.prim = { name, t0: performance.now() };
  if (S.mode !== "primitive") link.send({ cmd: "mode", mode: "primitive" });
  paintPrim();
}

const PRIM_LABEL = { rest: "Rest", pickAndPlace: "Pick & place", pinchTest: "Precision pinch", waveScan: "Waveform scan" };

function paintPrim() {
  const running = S.mode === "primitive" && S.prim;
  for (const b of document.querySelectorAll("#prim-buttons [data-prim]")) {
    b.classList.toggle("is-on", !!running && S.prim.name === b.dataset.prim);
  }
  for (const b of document.querySelectorAll("#prim-arms [data-arms]")) b.classList.toggle("is-on", b.dataset.arms === S.primArms);
  const tag = el("prim-tag");
  if (!running) {
    tag.textContent = "Off";
    tag.dataset.tone = "off";
    return;
  }
  const who = S.primArms === "both" ? "both arms" : S.primArms;
  let text = `${PRIM_LABEL[S.prim.name]} · ${who}`;
  if (S.prim.name === "pickAndPlace") {
    const k = Math.floor((performance.now() - S.prim.t0) / 1000 / PICK_CYCLE_S);
    text += ` · ${k % 2 === 0 ? "A → B" : "B → A"}`;
  }
  tag.textContent = text;
  tag.dataset.tone = "ok";
}

/* Everything on screen that follows a measurement moves by exponential
   approach, so a 20-30 Hz reading reads as motion at the display's rate.
   TAU is the time to close ~63% of a gap. */
const TAU_POSE = 0.07;
const TAU_UI = 0.12;
const approach = (dt, tau) => 1 - Math.exp(-dt / tau);
const shown = new Map();
function ease(key, target, dt, tau = TAU_UI) {
  const v = shown.has(key) ? shown.get(key) : target;
  const next = v + (target - v) * approach(dt, tau);
  shown.set(key, next);
  return next;
}
// Only touch the DOM when the rounded text actually changes.
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
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
  for (const arm of ARMS) {
    const h = fresh(arm);
    if (S.mode === "primitive" && S.prim && primRuns(arm)) {
      runPrimitive(arm, now);
      continue;
    }
    twin.setStations(arm, null);
    // Follower-only hands: the leader is not driven and shows its readings.
    const handDriven = S.mode === "hands" && (S.handsArms === "both" || arm === "follower");
    if (handDriven) {
      if (h) {
        const cart = filterTarget(arm, keepOut(h.cart, isLeftArm(arm), inwardLimit()));
        const q = ikJoints(cart);
        twin.setPose(arm, q);
        twin.setTarget(arm, cart);
        // Only while the hand is in view: a lost hand stops the stream and the
        // driver's watchdog holds the arm where it is.
        stream(arm, q, now);
      } else {
        twin.setTarget(arm, null);
      }
    } else {
      S.filtered[arm] = null;
      twin.setTarget(arm, null);
      if (S.present[arm]) {
        // Readings arrive at 20-30 Hz; glide between them. Starts from where
        // the twin already is, so leaving hands or a primitive does not jump.
        const goal = toUrdf(arm, S.present[arm]);
        const cur = twin.jointValues(arm) || goal;
        const k = approach(dt, TAU_POSE);
        twin.setPose(arm, cur.map((v, i) => v + (goal[i] - v) * k));
      }
    }
  }
  twin.frame(renderer);
  paintLive(dt);
}

/* Per-frame: the numbers and bars that follow the arms. */
function paintLive(dt) {
  for (const arm of ARMS) {
    const card = document.querySelector(`[data-arm-card="${arm}"]`);
    const q = twin.jointValues(arm);
    if (!q) continue;
    q.forEach((v, i) => {
      const lim = CONFIG.limits[i];
      const f = ease(`${arm}:j${i}`, Math.max(0, Math.min(1, (v - lim.min) / (lim.max - lim.min))), dt);
      card.querySelector(`[data-j="${i}"]`).style.left = `${(f * 100).toFixed(2)}%`;
      const shownVal = ease(`${arm}:v${i}`, i === 5 ? (v / GRIPPER_RAD_MAX) * 100 : v / DEG, dt);
      setText(card.querySelector(`[data-v="${i}"]`), i === 5 ? `${Math.round(shownVal)}%` : `${Math.round(shownVal)}°`);
    });
    const g = ease(`${arm}:grip`, (q[5] / GRIPPER_RAD_MAX) * 100, dt);
    setText(document.querySelector(`[data-grip-val="${arm}"]`), String(Math.round(g)));
    const ticks = document.querySelector(`[data-grip-ticks="${arm}"]`).children;
    const lit = (g / 100) * ticks.length;
    for (let i = 0; i < ticks.length; i++) {
      // The tick at the edge lights partially, so the bar grows rather than steps.
      const on = Math.max(0, Math.min(1, lit - i));
      ticks[i].style.setProperty("--on", on.toFixed(3));
    }
  }
  for (const side of ["left", "right"]) {
    const arm = side === S.prefs.leaderSide ? "leader" : "follower";
    const h = fresh(arm);
    const detail = el(`hand-slot-${side}`).querySelector('[data-role="detail"]');
    if (arm === "leader" && S.handsArms === "follower") {
      setText(detail, "not used");
      continue;
    }
    if (!h) {
      setText(detail, "not in view");
      shown.delete(`${side}:h`);
      shown.delete(`${side}:p`);
      continue;
    }
    const height = ease(`${side}:h`, h.heightPct, dt);
    const pinch = ease(`${side}:p`, h.pinch * 100, dt);
    setText(detail, `height ${Math.round(height)}% · grip ${Math.round(pinch)}%`);
  }
}

/* ---------------------------------------------------------------------- */
const TITLES = {
  idle: ["Ready", "Choose teleop or hands to begin."],
  teleop: ["Teleoperation", ""],
  hands: ["Hand Control", ""],
  primitive: ["Task Primitives", ""],
  manual: ["Settings open", ""]
};
const EXPLAIN = {
  idle: ["Two arms, two ways to drive them.",
    "Teleop: move the leader arm by hand and the follower copies it. Hands: both arms follow your hands under the camera, no contact needed."],
  teleop: ["Move the leader, the follower copies it.",
    "The leader arm's motors are switched off. Its joints are read fifty times a second and sent to the follower, which moves to match, limited to a safe speed."],
  hands: ["Your hands, read by a camera, drive both arms.",
    "A camera above the table finds both hands. Where each palm is sets where its arm reaches, how high it is sets the height, and opening your thumb opens the gripper. Each arm is solved with inverse kinematics many times a second."],
  primitive: ["Short, repeatable tasks, run by the arms themselves.",
    "Each primitive is a path for the gripper through space and time: reach, grip, carry, release. Inverse kinematics turns every point of it into joint angles. With both arms, the one on the left runs the mirror image."],
  manual: ["The arms are being set up.",
    "The settings page has control of the arms. Close it, or press Teleop or Hands, to take it back."],
  base: ["Drive the base from the keyboard or your phone.",
    "Three omniwheels set 120 degrees apart let it move in any direction and turn on the spot. The model follows the wheels' own speed readings, on an endless floor."]
};

function armTone(a) {
  if (!a || !a.spawned) return "off";
  if (!a.ready) return "warn";
  return a.dryRun ? "dry" : "ok";
}

function armStateTag(arm) {
  const a = S.arms[arm];
  if (!a || !a.spawned) return ["Offline", "off"];
  if (a.gaveUp) return ["Lost: check cable", "bad"];
  if (a.restarting) return ["Reconnecting", "warn"];
  if (!a.ready) return ["Starting", "warn"];
  if (S.mode === "teleop") return arm === "leader" ? ["Limp · read", "sun"] : ["Following", "ok"];
  if (S.mode === "hands") {
    if (S.handsArms === "follower" && arm === "leader") return ["Holding", "off"];
    return [fresh(arm) ? "Tracking hand" : "Waiting for hand", fresh(arm) ? "ok" : "warn"];
  }
  if (S.mode === "primitive") return S.prim && primRuns(arm) ? [PRIM_LABEL[S.prim.name], "ok"] : ["Holding", "off"];
  return [a.relaxed ? "Limp" : "Holding", a.dryRun ? "dry" : "off"];
}

function buildJointRows() {
  for (const arm of ARMS) {
    const box = document.querySelector(`[data-arm-card="${arm}"] [data-role="joints"]`);
    box.innerHTML = JOINT_LABEL.map((l, i) => `
      <div class="joint-row"><span>${l}</span><span class="bar"><i data-j="${i}" style="left:50%"></i></span><b data-v="${i}">0°</b></div>`).join("");
  }
  for (const t of document.querySelectorAll("[data-grip-ticks]")) {
    t.innerHTML = Array.from({ length: 36 }, () => "<span></span>").join("");
  }
}

function paintCards() {
  for (const arm of ARMS) {
    const card = document.querySelector(`[data-arm-card="${arm}"]`);
    const [text, tone] = armStateTag(arm);
    const tag = card.querySelector('[data-role="state"]');
    tag.textContent = text;
    tag.dataset.tone = tone;
    const side = S.prefs.leaderSide === "left" ? (arm === "leader" ? "left" : "right") : (arm === "leader" ? "right" : "left");
    card.querySelector('[data-role="side"]').textContent = `${side[0].toUpperCase()}${side.slice(1)} hand`;
    el(`st-${arm}`).dataset.tone = armTone(S.arms[arm]);
  }

  // Hand slots, in the operator's left/right.
  for (const side of ["left", "right"]) {
    const slot = el(`hand-slot-${side}`);
    const arm = side === S.prefs.leaderSide ? "leader" : "follower";
    const h = fresh(arm);
    slot.querySelector('[data-role="arm"]').textContent = arm === "leader" ? "Leader" : "Follower";
    slot.querySelector('[data-role="seen"]').dataset.tone = h ? "ok" : "off";
  }

  // Grip gauges, one per arm.
  const src = S.mode === "teleop" ? { leader: "your hand", follower: "from the leader" }
    : S.mode === "hands" ? { leader: "from your thumb", follower: "from your thumb" }
    : S.mode === "primitive" ? { leader: "from the routine", follower: "from the routine" }
    : { leader: "live", follower: "live" };
  for (const arm of ARMS) {
    document.querySelector(`[data-grip-source="${arm}"]`).textContent = src[arm];
  }
  // In teleop the leader's "gripper" is the trigger you squeeze; otherwise it is powered.
  document.querySelector('[data-grip-caption="leader"]').textContent = S.mode === "teleop" ? "Trigger, read by hand" : "Jaw aperture";
  paintPrim();

  // Hand camera status.
  const ht = el("hands-tag");
  if (hands.error) { ht.textContent = "Camera error"; ht.dataset.tone = "bad"; }
  else if (!hands.running) { ht.textContent = "Starting"; ht.dataset.tone = "warn"; }
  else if (!hands.fps) { ht.textContent = "Loading model"; ht.dataset.tone = "warn"; }
  else {
    ht.textContent = `${hands.fps} fps · ${Math.round(hands.inferMs)} ms`;
    ht.dataset.tone = "ok";
  }
  const c = hands.capture;
  ht.title = c ? `Camera ${c.width}×${c.height} at ${Math.round(c.frameRate || 0)} fps · ${hands.delegate || "loading"} · ` +
    `tracking ${hands.fps} fps, ${Math.round(hands.inferMs)} ms per frame` : "";
  el("hands-error").classList.toggle("hidden", !hands.error);
  if (hands.error) el("hands-error").textContent = hands.error;

  el("st-base").dataset.tone = !S.base || !S.base.spawned ? "off" : !S.base.ready ? "warn" : S.base.dryRun ? "dry" : "ok";
}

/* Swap text with a short fade, only when it actually changes. */
function fadeText(node, text) {
  if (node.dataset.text === text) return;
  node.dataset.text = text;
  if (!node.textContent) {
    node.textContent = text;
    return;
  }
  node.classList.add("is-fading");
  setTimeout(() => {
    node.textContent = text;
    node.classList.remove("is-fading");
  }, 180);
}

function paintMode() {
  for (const b of document.querySelectorAll("#mode-switch [data-mode]")) b.classList.toggle("is-on", b.dataset.mode === S.mode);
  if (S.view === "base") {
    fadeText(el("stage-title"), "Mobile Base");
    el("crumb-a").textContent = "LeKiwi";
    el("crumb-b").textContent = "Omniwheel base";
  } else {
    fadeText(el("stage-title"), TITLES[S.mode]?.[0] || "Ready");
    el("crumb-a").textContent = "SO-101 pair";
    el("crumb-b").textContent = "Leader & follower";
  }
  const tag = el("mode-tag");
  tag.textContent = { idle: "Idle", teleop: "Leader → follower", hands: "Hands → both arms", primitive: "Routine → arms", manual: "Settings in control" }[S.mode];
  tag.dataset.tone = S.mode === "idle" ? "off" : S.mode === "manual" ? "warn" : "ok";
  const note = el("mode-note-tag");
  note.classList.toggle("hidden", !S.modeNote);
  note.textContent = S.modeNote;
  el("subtitle-tags").classList.toggle("hidden", S.view === "base");
  // Teleop and primitives do not use the hands, so their camera folds away
  // and stops running the hand model; every other view shows both cameras.
  const handsAway = S.view === "arms" && (S.mode === "teleop" || S.mode === "primitive");
  el("slot-hands").classList.toggle("is-away", handsAway);
  setDetecting(!handsAway);
  setTrackingRender(!handsAway);
  const [t, b] = S.view === "base" ? EXPLAIN.base : EXPLAIN[S.mode] || EXPLAIN.idle;
  fadeText(el("explain-title"), t);
  fadeText(el("explain-body"), b);
}

/* ---------------------------------------------------------------------- */
let toastTimer = null;
function toast(text, count = "") {
  const t = el("toast");
  el("toast-text").textContent = text;
  el("toast-count").textContent = count;
  el("toast-count").classList.toggle("hidden", !count);
  t.classList.remove("hidden");
  t.classList.remove("toast-enter");
  void t.offsetWidth;
  t.classList.add("toast-enter");
  clearTimeout(toastTimer);
  if (!S.pending) toastTimer = setTimeout(() => t.classList.add("hidden"), 3500);
}

let countdownTimer = null;
function runCountdown() {
  clearInterval(countdownTimer);
  if (!S.pending) {
    if (el("toast-count").textContent) el("toast").classList.add("hidden");
    return;
  }
  const tick = () => {
    const left = Math.max(0, Math.ceil((S.pending?.at - Date.now()) / 1000));
    if (!S.pending || left <= 0) {
      clearInterval(countdownTimer);
      el("toast").classList.add("hidden");
      return;
    }
    toast("Hold the leader: its motors switch off", String(left));
  };
  tick();
  countdownTimer = setInterval(tick, 200);
}

/* ---------------------------------------------------------------------- */
function requestTelemetry() {
  // Readings drive the twin outside hands mode. The bridge runs the leader at
  // its own teleop rate while in teleop, so it is only asked for otherwise.
  link.send({ cmd: "telemetry", arm: "follower", on: true, hz: 20 });
  if (S.mode !== "teleop") link.send({ cmd: "telemetry", arm: "leader", on: true, hz: 20 });
}

function onMessage(msg) {
  if (msg.type === "hello") {
    S.arms = msg.arms || S.arms;
    S.base = msg.base || null;
    S.phoneUrls = msg.phoneUrls || [];
    if (msg.mode) Object.assign(S, { mode: msg.mode.mode, modeNote: msg.mode.note, pending: msg.mode.pending });
    for (const arm of ARMS) if (S.arms[arm]?.last?.command) S.present[arm] = S.arms[arm].last.command;
    paintPhone();
    paintMode();
    requestTelemetry();
    runCountdown();
  } else if (msg.type === "mode") {
    const prevMode = S.mode;
    Object.assign(S, { mode: msg.mode, modeNote: msg.note || "", pending: msg.pending || null });
    // Leaving primitive mode (Stop, another mode, a refusal) ends the routine.
    if (S.mode !== "primitive") S.prim = null;
    if (msg.refused) toast(msg.refused);
    paintMode();
    runCountdown();
    if (prevMode !== S.mode) requestTelemetry();
  } else if (msg.arm && ARMS.includes(msg.arm)) {
    const arm = msg.arm;
    const a = (S.arms[arm] ||= { spawned: true });
    if (msg.type === "ready") {
      Object.assign(a, { spawned: true, ready: true, restarting: false, gaveUp: false, dryRun: !!msg.dry_run, relaxed: !!msg.relaxed, identityMap: !!msg.identity_map });
      if (msg.present) S.present[arm] = msg.present;
      requestTelemetry();
    } else if (msg.type === "present") {
      S.present[arm] = msg.pos;
    } else if (msg.type === "status") {
      a.relaxed = !!msg.relaxed;
      // Without telemetry, the commanded pose is the next best picture.
      if (!S.present[arm]) S.present[arm] = msg.command;
    } else if (msg.kind === "exit") {
      a.ready = false;
    } else if (msg.kind === "restarting") {
      a.restarting = true;
      toast(`${arm === "leader" ? "Leader" : "Follower"} lost its bus, reconnecting`);
    } else if (msg.kind === "gave_up") {
      a.restarting = false;
      a.gaveUp = true;
      toast(`${arm === "leader" ? "Leader" : "Follower"} keeps dropping: check its cable and power`);
    }
  } else if (msg.type === "base") {
    S.base = S.base || { spawned: true };
    if (msg.kind === "ready") Object.assign(S.base, { spawned: true, ready: true, dryRun: msg.dry_run });
    if (msg.kind === "exit") S.base.ready = false;
  }
}

function onLinkDrop() {
  S.arms = { leader: null, follower: null };
  S.base = null;
}

function paintPhone() {
  const box = el("phone-urls");
  box.innerHTML = S.phoneUrls.length
    ? S.phoneUrls.map((u) => `<div class="text-lg font-medium text-ember break-all">${u.replace(/^http:\/\//, "")}</div>`).join("")
    : '<span class="text-ink-40 text-sm">No network address found</span>';
}

async function loadMaps() {
  for (const arm of ARMS) {
    try {
      const r = await fetch(`/api/joint-map?arm=${arm}`);
      S.maps[arm] = r.ok ? await r.json() : null;
    } catch {
      S.maps[arm] = null;
    }
  }
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

function showPresenter() {
  const show = (id, text) => {
    const node = el(id);
    node.textContent = text;
    node.classList.toggle("hidden", !text);
  };
  show("presenter-event", PRESENTER.event);
  show("presenter-name", PRESENTER.name);
  show("presenter-card-name", PRESENTER.name);
  show("presenter-caption", PRESENTER.caption);
  if (PRESENTER.qr) {
    el("presenter-qr").src = PRESENTER.qr;
    el("presenter-qr").alt = `QR code: ${PRESENTER.name}`;
    el("presenter-qr").classList.remove("hidden");
  }
  el("presenter-card").classList.toggle("hidden", !(PRESENTER.name && PRESENTER.qr));
}

async function boot() {
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
    if (camsChanged) {
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
  startCameras();
}

boot().catch((err) => {
  console.error("Stage failed to start:", err);
  el("stage-title").textContent = "Failed to start";
  el("explain-body").textContent = err.message;
});
