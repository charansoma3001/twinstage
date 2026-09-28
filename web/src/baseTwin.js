import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadURDF } from "./urdf.js";

// Supplied by the page in initBaseTwin: the renderer, its container, and the
// bridge link (connect / isConnected / onMessage / send).
let renderer = null;
let container = null;
let link = null;
const sendCommand = (o) => link && link.send(o);
const isConnected = () => !!link && link.isConnected();

/* =========================================================================
   LeKiwi base twin: its own scene on the shared renderer.

   Pose comes from the driver's wheel odometry, which drifts. The floor is an
   endless grid that follows the base, so there is no room for the drift to be
   wrong against: the twin shows how the base is moving, not where it is.
   ========================================================================= */
const URDF_URL = "urdf/LeKiwi/LeKiwi.urdf";   // under BASE_URL
// Wheel centre is 17.9 mm above the URDF root; the omniwheel is 101.6 mm across.
const FLOOR_OFFSET = 0.0508 - 0.0179;
const WHEEL_JOINTS = ["base_left_wheel", "base_back_wheel", "base_right_wheel"];
const SEND_MS = 50;
const TRAIL_POINTS = 600;

// Light stage theme: the page's warm gradient shows through; fog matches it
// so the endless floor fades out rather than ending.
const FOG = 0xf1ece4;
export const baseScene = new THREE.Scene();
baseScene.fog = new THREE.Fog(FOG, 2.5, 9);

export let baseCamera = null;
export let baseControls = null;

baseScene.add(new THREE.HemisphereLight(0xffffff, 0xe9e1d4, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(1.5, 3, 1);
key.castShadow = true;
key.shadow.camera.left = key.shadow.camera.bottom = -1;
key.shadow.camera.right = key.shadow.camera.top = 1;
baseScene.add(key);
baseScene.add(key.target);
const fill = new THREE.DirectionalLight(0xffd2a8, 0.4);
fill.position.set(-1.2, 1.5, -1.5);
baseScene.add(fill);

// Endless floor: a finite grid re-centred under the base on whole cells.
const CELL = 0.25;
const floorGroup = new THREE.Group();
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0xf3eee6, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floorGroup.add(floor);
const grid = new THREE.GridHelper(40, 40 / CELL, 0xd4c8b6, 0xe4dccf);
grid.position.y = 0.001;
floorGroup.add(grid);
baseScene.add(floorGroup);

// Where the base has been, fading into the fog like the grid.
const trailPositions = new Float32Array(TRAIL_POINTS * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xfe5e0e, transparent: true, opacity: 0.8 }));
trail.frustumCulled = false;
baseScene.add(trail);
let trailCount = 0;

// The model: URDF is Z-up with the base driving along +Y. Scene is Y-up and
// the base drives along +Z, so URDF (x,y,z) -> scene (-x,z,y), a proper rotation.
const baseGroup = new THREE.Group();
baseScene.add(baseGroup);
let model = null;

function colourFor(file) {
  if (/Omni-Directional-Wheel/.test(file)) return 0x2b2f38;
  if (/ST3215|STS3215/.test(file)) return 0x1f2430;
  if (/SO_ARM100|Base_08q|Rotation_Pitch|Wrist|Moving_Jaw/.test(file)) return 0xfe5e0e;
  if (/Battery/.test(file)) return 0x000b1a;
  if (/Camera-Model/.test(file)) return 0x1f2430;
  if (/Standoff/.test(file)) return 0xfebe42;
  return 0xf7f4ef;
}

async function loadModel() {
  model = await loadURDF(URDF_URL);
  const holder = new THREE.Group();
  holder.setRotationFromMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0)
  ));
  holder.position.y = FLOOR_OFFSET;
  holder.add(model.root);
  model.root.traverse((o) => {
    if (!o.isMesh) return;
    o.material.color.setHex(colourFor(o.userData.file || ""));
    o.material.roughness = 0.45;
  });
  baseGroup.add(holder);
}

/* ---------------------------------------------------------------------- */
const state = {
  active: false,
  pose: [0, 0, 0],       // x fwd m, y left m, heading deg (driver odometry)
  vel: [0, 0, 0],
  wheels: [0, 0, 0],
  speed: 0.7,
  info: null,            // bridge's view of the base driver
  busyUntil: 0,
  lastOdomAt: 0
};
const keys = new Set();
let wasMoving = false;
let hud = {};

// What the twin shows, gliding toward the latest odometry (20 Hz) every frame.
const shown = { pose: [0, 0, 0], wheels: [0, 0, 0] };
const TAU = 0.08;

const wrap = (a, period) => ((a % period) + period * 1.5) % period - period / 2;

function glide(dt) {
  const k = 1 - Math.exp(-dt / TAU);
  const [x, y, th] = state.pose;
  // A reset (or a stalled link catching up) is a jump, not a journey.
  if (Math.hypot(x - shown.pose[0], y - shown.pose[1]) > 0.5) {
    shown.pose = [...state.pose];
    shown.wheels = [...state.wheels];
    return;
  }
  shown.pose[0] += (x - shown.pose[0]) * k;
  shown.pose[1] += (y - shown.pose[1]) * k;
  shown.pose[2] += wrap(th - shown.pose[2], 360) * k;           // shortest way round
  for (let i = 0; i < 3; i++) shown.wheels[i] += wrap(state.wheels[i] - shown.wheels[i], 2 * Math.PI) * k;
}

function setPoseFromOdom() {
  const [x, y, thDeg] = shown.pose;
  baseGroup.position.set(y, 0, x);
  baseGroup.rotation.y = THREE.MathUtils.degToRad(thDeg);
  if (model) WHEEL_JOINTS.forEach((j, i) => model.joints[j]?.setValue(shown.wheels[i]));

  // Grid follows on whole cells, so its lines stay put under the base.
  floorGroup.position.set(Math.round(y / CELL) * CELL, 0, Math.round(x / CELL) * CELL);
  key.position.set(y + 1.5, 3, x + 1);
  key.target.position.set(y, 0, x);
}

function pushTrail() {
  const px = baseGroup.position.x, pz = baseGroup.position.z;
  const n = trailCount;
  if (n > 0) {
    const lx = trailPositions[(n - 1) * 3], lz = trailPositions[(n - 1) * 3 + 2];
    if (Math.hypot(px - lx, pz - lz) < 0.01) return;
  }
  if (n === TRAIL_POINTS) {
    trailPositions.copyWithin(0, 3);
    trailCount--;
  }
  trailPositions.set([px, 0.003, pz], trailCount * 3);
  trailCount++;
  trailGeo.setDrawRange(0, trailCount);
  trailGeo.attributes.position.needsUpdate = true;
}

function clearTrail() {
  trailCount = 0;
  trailGeo.setDrawRange(0, 0);
}

/* The camera keeps whatever orbit the user chose and is carried along with
   the base, rather than being re-aimed every frame. */
const _prev = new THREE.Vector3();
function followCamera() {
  _prev.copy(baseControls.target);
  const t = baseGroup.position;
  const dx = t.x - _prev.x, dz = t.z - _prev.z;
  baseCamera.position.x += dx;
  baseCamera.position.z += dz;
  baseControls.target.set(t.x, 0.1, t.z);
}

/* ---------------------------------------------------------------------- */
function driveInput() {
  const f = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
  const s = (keys.has("KeyA") ? 1 : 0) - (keys.has("KeyD") ? 1 : 0);
  const w = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0);
  return { x: f * state.speed, y: s * state.speed, w: w * state.speed };
}

function tick() {
  if (!state.active) return;
  const d = driveInput();
  const moving = d.x !== 0 || d.y !== 0 || d.w !== 0;
  if (moving) sendCommand({ cmd: "drive", ...d });
  else if (wasMoving) sendCommand({ cmd: "drive", x: 0, y: 0, w: 0 });
  wasMoving = moving;
  renderHud();
}

function stopBase() {
  keys.clear();
  wasMoving = false;
  sendCommand({ cmd: "base_stop" });
  renderKeys();
}

const DRIVE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyA", "KeyD"]);

function onKeyDown(ev) {
  if (!state.active) return;
  if (ev.code === "Space" || ev.key === "Escape") {
    ev.preventDefault();
    stopBase();
    return;
  }
  if (!DRIVE_KEYS.has(ev.code)) return;
  // A focused slider would also take the arrow key; the base wins here.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  ev.preventDefault();
  keys.add(ev.code);
  renderKeys();
}

function onKeyUp(ev) {
  if (!DRIVE_KEYS.has(ev.code)) return;
  keys.delete(ev.code);
  renderKeys();
}

/* ---------------------------------------------------------------------- */
function renderKeys() {
  for (const el of hud.keyEls || []) el.classList.toggle("held", keys.has(el.dataset.key));
}

function renderHud() {
  if (!hud.status) return;
  const now = performance.now();
  let text, tone;
  if (!isConnected()) { text = "Bridge offline"; tone = "off"; }
  else if (now < state.busyUntil) { text = "Someone else is driving"; tone = "warn"; }
  else if (!state.info || !state.info.spawned) { text = "No base on the bridge"; tone = "warn"; }
  else if (!state.info.ready) { text = "Base starting"; tone = "warn"; }
  else if (now - state.lastOdomAt > 1500) { text = "No odometry"; tone = "bad"; }
  else { text = state.info.dryRun ? "Dry run" : "Live"; tone = state.info.dryRun ? "dry" : "ok"; }
  hud.status.textContent = text;
  hud.dot.dataset.tone = tone;
  const [vx, vy, wz] = state.vel;
  hud.vel.textContent = `${vx.toFixed(2)} fwd  ${vy.toFixed(2)} left  m/s   ${wz.toFixed(0)}°/s`;
  const dist = Math.hypot(state.pose[0], state.pose[1]);
  hud.odom.textContent = `${dist.toFixed(2)} m from start   heading ${state.pose[2].toFixed(0)}°`;
}

function initHud() {
  hud = {
    root: document.getElementById("base-hud"),
    status: document.getElementById("base-status"),
    dot: document.getElementById("base-dot"),
    vel: document.getElementById("base-vel"),
    odom: document.getElementById("base-odom"),
    keyEls: Array.from(document.querySelectorAll("#base-keys [data-key]"))
  };
  document.getElementById("base-stop").addEventListener("click", stopBase);
  document.getElementById("base-reset").addEventListener("click", () => {
    sendCommand({ cmd: "base_reset_odom" });
    clearTrail();
  });
  const speedBtns = Array.from(document.querySelectorAll("#base-speed [data-s]"));
  for (const b of speedBtns) {
    b.addEventListener("click", () => {
      state.speed = Number(b.dataset.s);
      for (const x of speedBtns) x.classList.toggle("is-on", x === b);
      b.blur();
    });
  }
}

/* ---------------------------------------------------------------------- */
export function setBaseActive(on) {
  state.active = on;
  if (baseControls) baseControls.enabled = on;
  if (!on) {
    if (keys.size || wasMoving) stopBase();
    return;
  }
  if (!isConnected()) link.connect();
  resizeBaseViewport();
}

export function isBaseActive() {
  return state.active;
}

export function resizeBaseViewport() {
  if (!baseCamera) return;
  baseCamera.aspect = container.clientWidth / container.clientHeight;
  baseCamera.updateProjectionMatrix();
}

export function updateBaseTwin(dt = 1 / 60) {
  glide(dt);
  setPoseFromOdom();
  pushTrail();
  followCamera();
  baseControls.update();
}

export async function initBaseTwin(deps) {
  ({ renderer, container, link } = deps);
  baseCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 50);
  baseCamera.position.set(0.9, 0.8, -1.1);
  baseControls = new OrbitControls(baseCamera, renderer.domElement);
  baseControls.enableDamping = true;
  baseControls.dampingFactor = 0.08;
  baseControls.target.set(0, 0.1, 0);
  baseControls.maxPolarAngle = Math.PI / 2 - 0.05;
  baseControls.minDistance = 0.3;
  baseControls.maxDistance = 6;
  baseControls.enabled = false;

  initHud();
  link.onMessage((msg) => {
    if (msg.type === "hello") state.info = msg.base || null;
    if (msg.type !== "base") return;
    if (msg.kind === "odom") {
      state.pose = msg.pose;
      state.vel = msg.vel;
      state.wheels = msg.wheels;
      state.lastOdomAt = performance.now();
    } else if (msg.kind === "ready") {
      state.info = { ...(state.info || {}), spawned: true, ready: true, dryRun: msg.dry_run };
    } else if (msg.kind === "exit") {
      state.info = { ...(state.info || {}), ready: false };
    } else if (msg.kind === "busy") {
      state.busyUntil = performance.now() + 1200;
    }
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  // A key held while the window loses focus never sends its keyup.
  window.addEventListener("blur", () => { if (state.active) stopBase(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && state.active) stopBase(); });
  setInterval(tick, SEND_MS);

  setPoseFromOdom();
  // The model is not needed to drive, so a failed load leaves driving working.
  try {
    await loadModel();
    setPoseFromOdom();
  } catch (err) {
    console.error("LeKiwi model failed to load:", err);
    if (hud.status) hud.status.textContent = `Model failed: ${err.message}`;
  }
}
