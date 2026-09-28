import { CONFIG, PRESENTER, IS_DEMO } from "../config.js";
import * as twin from "./twin.js";
import { hands, fresh, setDetecting } from "./hands.js";
import { PICK_CYCLE_S } from "../primitives.js";
import { S, ARMS, el, primRuns, approach, TAU_UI } from "./state.js";
import { setTrackingRender } from "./view.js";

/* =========================================================================
   Everything the stage draws in the DOM: the mode title and explainer, the
   arm and hand cards, the grip gauges, toasts and the presenter card. The
   twin itself is drawn by twin.js.
   ========================================================================= */
const JOINT_LABEL = ["Pan", "Lift", "Elbow", "W-Flex", "W-Roll", "Grip"];
const GRIPPER_RAD_MAX = CONFIG.limits[5].max;
const DEG = Math.PI / 180;

export const PRIM_LABEL = { rest: "Rest", pickAndPlace: "Pick & place", pinchTest: "Precision pinch", waveScan: "Waveform scan" };

export function paintPrim() {
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

/* Per-frame: the numbers and bars that follow the arms. */
export function paintLive(dt) {
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

export function buildJointRows() {
  for (const arm of ARMS) {
    const box = document.querySelector(`[data-arm-card="${arm}"] [data-role="joints"]`);
    box.innerHTML = JOINT_LABEL.map((l, i) => `
      <div class="joint-row"><span>${l}</span><span class="bar"><i data-j="${i}" style="left:50%"></i></span><b data-v="${i}">0°</b></div>`).join("");
  }
  for (const t of document.querySelectorAll("[data-grip-ticks]")) {
    t.innerHTML = Array.from({ length: 36 }, () => "<span></span>").join("");
  }
}

export function paintCards() {
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

export function paintMode() {
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
export function toast(text, count = "") {
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
export function runCountdown() {
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

export function paintPhone() {
  const box = el("phone-urls");
  box.innerHTML = S.phoneUrls.length
    ? S.phoneUrls.map((u) => `<div class="text-lg font-medium text-ember break-all">${u.replace(/^http:\/\//, "")}</div>`).join("")
    : IS_DEMO
      ? '<span class="text-ink-40 text-sm">Driving from a phone needs the bridge running on your own machine.</span>'
      : '<span class="text-ink-40 text-sm">No network address found</span>';
}

export function showPresenter() {
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
