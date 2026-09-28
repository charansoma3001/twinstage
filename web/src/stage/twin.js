import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ARM } from "../config.js";
import { loadURDF } from "../urdf.js";
import { REST_JOINTS } from "../primitives.js";
import { mountSO101, setJoints, jointValues as so101JointValues } from "../so101.js";

/* =========================================================================
   Two SO-101 arms, side by side, as the operator sees them.

   The camera sits behind the arms looking where they reach (+Z), so the
   screen's left is the operator's left. The retargeting puts the operator's
   left at +X (the invert-X default), and a camera looking along +Z has +X on
   screen left: the picture, the hands and the arms all agree.
   ========================================================================= */
export const ARM_SPACING = 0.3;   // default; the rig's real spacing comes from prefs
export const COLOURS = { follower: 0xfe5e0e, leader: 0xfebe42 };

export const scene = new THREE.Scene();

let camera = null;
let controls = null;
const arms = {};           // name -> { holder, robot, target }

function lights() {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e1d4, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-0.6, 1.4, -0.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -0.8;
  key.shadow.camera.right = key.shadow.camera.top = 0.8;
  key.shadow.radius = 6;
  scene.add(key);
  const warm = new THREE.DirectionalLight(0xffd2a8, 0.45);
  warm.position.set(0.8, 0.6, 0.9);
  scene.add(warm);
}

function floor() {
  // Only the shadow is drawn; the page's gradient is the floor.
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.ShadowMaterial({ opacity: 0.14 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  const grid = new THREE.GridHelper(2.4, 48, 0xd9cfc0, 0xe7dfd3);
  grid.position.y = 0.0005;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  // Each arm's reachable table patch, tinted in its colour.
  for (const name of ["leader", "follower"]) {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.22),
      new THREE.MeshBasicMaterial({ color: COLOURS[name], transparent: true, opacity: 0.08, depthWrite: false })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.001, 0.23);
    pad.userData.padFor = name;
    scene.add(pad);
  }
}

function tint(robot, colour) {
  const body = new THREE.Color(colour);
  const dark = new THREE.Color(0x1f2430);
  robot.root.traverse((o) => {
    if (!o.isMesh) return;
    const file = o.userData.file || "";
    const servo = /sts3215/i.test(file);
    o.material = new THREE.MeshStandardMaterial({
      color: servo ? dark : body,
      roughness: servo ? 0.5 : 0.42,
      metalness: 0.05
    });
    o.castShadow = true;
  });
}

async function loadArm(name) {
  const robot = await loadURDF(ARM.urdfUrl);
  const holder = new THREE.Group();
  holder.add(mountSO101(robot).holder);
  tint(robot, COLOURS[name]);

  const target = new THREE.Mesh(
    new THREE.SphereGeometry(0.009, 20, 20),
    new THREE.MeshBasicMaterial({ color: COLOURS[name] })
  );
  target.visible = false;
  holder.add(target);

  // Pick & place stations: where to tape the block's two spots on the table.
  const stations = new THREE.Group();
  for (const label of ["A", "B"]) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.024, 40),
      new THREE.MeshBasicMaterial({ color: COLOURS[name], transparent: true, opacity: 0.9, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(0.018, 40),
      new THREE.MeshBasicMaterial({ color: COLOURS[name], transparent: true, opacity: 0.18, depthWrite: false })
    );
    fill.rotation.x = -Math.PI / 2;
    g.add(ring, fill, labelSprite(label));
    g.userData.label = label;
    stations.add(g);
  }
  stations.visible = false;
  holder.add(stations);

  scene.add(holder);
  arms[name] = { holder, robot, target, stations };
}

function labelSprite(text) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  x.font = "600 40px Urbanist, system-ui, sans-serif";
  x.fillStyle = "#000B1A";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, 32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(0.03, 0.03, 1);
  s.position.y = 0.03;
  return s;
}

/* stations: [{x, z}, {x, z}] in the arm's frame, or null to hide them. */
export function setStations(name, stations) {
  const a = arms[name];
  if (!a) return;
  a.stations.visible = !!stations;
  if (!stations) return;
  a.stations.children.forEach((g, i) => g.position.set(stations[i].x, 0.002, stations[i].z));
}

/* leaderSide "left" puts the leader on the operator's left, i.e. +X. */
export function setLayout(leaderSide, spacing = ARM_SPACING) {
  const leftX = spacing / 2;
  const x = { leader: leaderSide === "left" ? leftX : -leftX, follower: leaderSide === "left" ? -leftX : leftX };
  for (const name of Object.keys(arms)) arms[name].holder.position.x = x[name];
  scene.traverse((o) => {
    if (o.userData.padFor) o.position.x = x[o.userData.padFor];
  });
}

export function setPose(name, q) {
  const a = arms[name];
  if (!a) return;
  setJoints(a.robot, q);
}

export function jointValues(name) {
  const a = arms[name];
  return a ? so101JointValues(a.robot) : null;
}

export function setTarget(name, cart) {
  const a = arms[name];
  if (!a) return;
  a.target.visible = !!cart;
  if (cart) a.target.position.set(cart.x, cart.y, cart.z);
}

export function resize(container) {
  if (!camera) return;
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
}

export function frame(renderer) {
  controls.update();
  renderer.render(scene, camera);
}

export function setEnabled(on) {
  if (controls) controls.enabled = on;
}

export function resetView() {
  // Far enough back that both arms, fully raised, clear the title and the
  // card row; aimed a little low so they sit in the band between the two.
  camera.position.set(0, 0.78, -1.05);
  controls.target.set(0, 0.06, 0.12);
}

export async function initTwin(renderer, container, leaderSide, spacing) {
  camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.01, 20);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.minDistance = 0.35;
  controls.maxDistance = 2.2;
  resetView();
  lights();
  floor();
  await Promise.all([loadArm("leader"), loadArm("follower")]);
  setLayout(leaderSide, spacing);
  setPose("leader", REST_JOINTS);
  setPose("follower", REST_JOINTS);
}
