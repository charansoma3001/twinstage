import { HAND_CONNECTIONS } from "../config.js";
import { state } from "../state.js";
import { retargetHand, inverseBilinear } from "../retarget.js";
import { openCamera } from "../prefs.js";
import { createHandTracker } from "../handTracker.js";

/* =========================================================================
   Two hands from one top-down camera.

   Each hand works the whole calibrated table, mapped over its own arm's
   workspace; the arms stand far enough apart that splitting the table in half
   only cost each hand half its travel. Which hand is which comes from MediaPipe's handedness
   label (flippable, because a top-down view can read them swapped); if both
   hands come back with the same label, their position on the table decides.

   The camera frame and the skeletons are drawn on one canvas, so the overlay
   cannot drift off the image whatever the camera's aspect ratio.
   ========================================================================= */
const STALE_MS = 300;

const COLOUR = { leader: "#FEBE42", follower: "#FE5E0E" };


export const hands = {
  running: false,
  error: null,
  fps: 0,
  inferMs: 0,        // frame grab -> results, smoothed
  delegate: null,    // "GPU" or "CPU", whichever loaded
  model: "off",      // "off" | "loading" | "on": loaded for hands mode, not with the page
  capture: null,     // what the camera actually delivers: { width, height, frameRate }
  // arm -> { cart, pinch, heightPct, side, label, at } for the latest detection
  byArm: { leader: null, follower: null }
};

let video = null;
let canvas = null;
let ctx = null;
let tracker = null;
let stream = null;
let prefs = { leaderSide: "left", flipLabels: false, upsideDown: false };
let lastResults = null;
let frames = 0, fpsT = performance.now();

/* Folded-away hand camera: keep the model loaded and the camera open, so
   coming back is instant, but stop running inference and drawing frames
   nobody sees. */
let detecting = true;
export function setDetecting(on) {
  detecting = on;
  if (!on) lastResults = null;
}

export function setHandPrefs(p) {
  prefs = { ...prefs, ...p };
}

function armForSide(side) {
  return side === prefs.leaderSide ? "leader" : "follower";
}

/* Where a hand sits across the table, 0 = operator's left. */
function quadS(landmarks) {
  const idx = [0, 5, 9, 17];
  let u = idx.reduce((a, i) => a + landmarks[i].x, 0) / 4;
  const v = idx.reduce((a, i) => a + landmarks[i].y, 0) / 4;
  if (state.isVideoMirrored) u = 1 - u;
  const tc = state.calibration.tableCorners;
  return inverseBilinear({ u, v }, tc.tl, tc.tr, tc.br, tc.bl).s;
}

const PALM = [0, 5, 9, 17];
function palmCentre(lm) {
  return { x: PALM.reduce((a, i) => a + lm[i].x, 0) / 4, y: PALM.reduce((a, i) => a + lm[i].y, 0) / 4 };
}
function palmSize(lm) {
  return Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 0.05;
}
/* Two detections this close are one hand reported twice, not two hands:
   real hands cannot overlap by more than half a palm. */
function sameHand(a, b) {
  const ca = palmCentre(a), cb = palmCentre(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y) < 0.5 * Math.max(palmSize(a), palmSize(b));
}

export function assignHands(results) {
  let list = (results.multiHandLandmarks || []).map((lm, i) => {
    let label = results.multiHandedness?.[i]?.label || "Right";
    if (prefs.flipLabels) label = label === "Left" ? "Right" : "Left";
    return { lm, side: label === "Left" ? "left" : "right", s: quadS(lm), score: results.multiHandedness?.[i]?.score ?? 0 };
  });
  // MediaPipe sometimes reports one hand as two overlapping detections,
  // often with opposite labels; keep the more confident one.
  if (list.length === 2 && sameHand(list[0].lm, list[1].lm)) {
    list = [list[0].score >= list[1].score ? list[0] : list[1]];
  }
  if (prefs.onlyFollower) {
    // One arm to drive: the follower-side hand if there is one, else any hand.
    if (!list.length) return list;
    const followerSide = prefs.leaderSide === "left" ? "right" : "left";
    const pick = list.find((h) => h.side === followerSide) || list[0];
    return [{ ...pick, side: followerSide }];
  }
  if (list.length === 2 && list[0].side === list[1].side) {
    // Two hands, one label: the classifier is confused, the table is not.
    list.sort((a, b) => a.s - b.s);
    list[0].side = "left";
    list[1].side = "right";
  }
  return list;
}

export function onResults(results) {
  lastResults = results;
  const now = performance.now();
  const assigned = assignHands(results);
  const took = new Set();
  for (const h of assigned) {
    const arm = armForSide(h.side);
    const r = retargetHand(h.lm);
    hands.byArm[arm] = {
      cart: r.cartesian, pinch: r.pinch, heightPct: r.heightGaugePct,
      side: h.side, at: now, landmarks: h.lm
    };
    took.add(arm);
  }
  // A hand whose label flipped this frame now belongs to the other arm; the
  // arm it left must let go at once, not keep it "fresh" for another 300 ms.
  // In follower-only the leader takes no hand at all.
  for (const arm of ["leader", "follower"]) {
    const prev = hands.byArm[arm];
    if (took.has(arm) || !prev) continue;
    if ((prefs.onlyFollower && arm === "leader") || assigned.some((h) => sameHand(h.lm, prev.landmarks))) {
      hands.byArm[arm] = null;
    }
  }
  frames++;
  if (now - fpsT > 1000) {
    hands.fps = Math.round((frames * 1000) / (now - fpsT));
    frames = 0;
    fpsT = now;
  }
}

export function fresh(arm) {
  const h = hands.byArm[arm];
  return h && performance.now() - h.at < STALE_MS ? h : null;
}

/* ---------------------------------------------------------------------- */
function coverRect(vw, vh, cw, ch) {
  const scale = Math.max(cw / vw, ch / vh);
  const w = vw * scale, h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

function toCanvas(r, u, v) {
  const x = state.isVideoMirrored ? 1 - u : u;
  return [r.x + x * r.w, r.y + v * r.h];
}

function drawQuad(r) {
  const tc = state.calibration.tableCorners;
  ctx.beginPath();
  [tc.tl, tc.tr, tc.br, tc.bl].forEach((p, i) => {
    const [x, y] = toCanvas(r, p.u, p.v);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawHand(r, lm, colour, text) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const [a, b] of HAND_CONNECTIONS) {
    const [x1, y1] = toCanvas(r, lm[a].x, lm[a].y);
    const [x2, y2] = toCanvas(r, lm[b].x, lm[b].y);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffffff";
  for (const p of lm) {
    const [x, y] = toCanvas(r, p.x, p.y);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const [wx, wy] = toCanvas(r, lm[0].x, lm[0].y);
  // An upside-down picture keeps its labels readable: each one is turned
  // back about its own centre.
  ctx.save();
  if (prefs.upsideDown) {
    ctx.translate(wx, wy + 24);
    ctx.rotate(Math.PI);
    ctx.translate(-wx, -(wy + 24));
  }
  ctx.font = "600 13px Urbanist, system-ui, sans-serif";
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(wx - w / 2, wy + 12, w, 24, 12);
  ctx.fill();
  ctx.fillStyle = "#000B1A";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, wx, wy + 24);
  ctx.restore();
}

function draw() {
  if (!canvas) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // The whole picture, overlay included, turns for a camera mounted upside down.
  if (prefs.upsideDown) {
    ctx.translate(cw, ch);
    ctx.rotate(Math.PI);
  }
  if (!video || video.readyState < 2) return;
  const r = coverRect(video.videoWidth, video.videoHeight, cw, ch);
  ctx.save();
  if (state.isVideoMirrored) {
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, cw - r.x - r.w, r.y, r.w, r.h);
  } else {
    ctx.drawImage(video, r.x, r.y, r.w, r.h);
  }
  ctx.restore();
  drawQuad(r);
  if (!lastResults) return;
  for (const arm of ["leader", "follower"]) {
    const h = fresh(arm);
    if (h) drawHand(r, h.landmarks, COLOUR[arm], arm === "leader" ? "LEADER" : "FOLLOWER");
  }
}

/* ---------------------------------------------------------------------- */
let generation = 0;
function pump(gen) {
  if (!hands.running || gen !== generation) return;
  if (detecting) {
    if (tracker) tracker.send(video);
    draw();
  }
  if (tracker) hands.inferMs = tracker.inferMs;
  requestAnimationFrame(() => pump(gen));
}

/* The camera and the model are separate: the picture can show with no model
   loaded, and the model (about 10 MB and a GPU context) loads only for
   hands mode. */
let opening = 0;
export async function startHands(videoEl, canvasEl, cameraId) {
  video = videoEl;
  canvas = canvasEl;
  ctx = canvas.getContext("2d");
  hands.error = null;
  const mine = ++opening;
  try {
    // 640x480: the size /settings calibrates at, so the corners mean the same
    // pixels here (a 16:9 request can make the camera crop its sensor
    // differently). Speed is the same at 1280x720 (measured).
    const s = await openCamera(cameraId, { width: 640, height: 480, frameRate: 60 });
    // Stopped while the camera was still opening.
    if (mine !== opening) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = s;
    const st = stream.getVideoTracks()[0]?.getSettings?.() || {};
    hands.capture = { width: st.width, height: st.height, frameRate: st.frameRate };
    console.info("Hand camera:", hands.capture);
    video.srcObject = stream;
    await video.play();
    hands.running = true;
    const gen = ++generation;
    requestAnimationFrame(() => pump(gen));
  } catch (err) {
    if (mine !== opening) return;
    hands.error = err.message || String(err);
    console.error("Hand camera failed:", err);
  }
}

export function stopHands() {
  opening++;
  hands.running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  lastResults = null;
}

/* Switching cameras keeps the model: the tracker outlives the stream. */
export async function loadHandModel() {
  if (tracker) return;
  const t = (tracker = createHandTracker({ numHands: 2, onResults }));
  hands.model = "loading";
  try {
    const delegate = await t.ready;
    if (tracker !== t) return;   // unloaded while it loaded
    hands.delegate = delegate;
    hands.model = "on";
    console.info("Hand tracking on", delegate);
  } catch (err) {
    if (tracker !== t) return;
    tracker = null;
    hands.model = "off";
    hands.error = `Hand model failed: ${err.message || err}`;
    console.error("Hand model failed:", err);
  }
}

export function unloadHandModel() {
  if (!tracker) return;
  tracker.close();
  tracker = null;
  Object.assign(hands, { model: "off", delegate: null, fps: 0, inferMs: 0 });
  hands.byArm.leader = hands.byArm.follower = null;
  lastResults = null;
}

export async function restartHands(cameraId) {
  stopHands();
  await startHands(video, canvas, cameraId);
}
