import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CONFIG } from "./config.js";
import { state } from "./state.js";
import { toolPoint } from "./robot.js";

/* =========================================================================
   THREE.JS 3D SCENE SETUP & CALIBRATED WORKBENCH
   ========================================================================= */
export const container = document.getElementById("canvas-container");

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d16);
scene.fog = new THREE.FogExp2(0x090d16, 0.45);

export const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 10);
camera.position.set(0.5, 0.45, 0.65);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.15, 0.15);
controls.maxPolarAngle = Math.PI / 2 + 0.05;

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const mainLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
mainLight.position.set(0.8, 1.2, 0.6);
mainLight.castShadow = true;
scene.add(mainLight);
const fillLight = new THREE.DirectionalLight(0xf97316, 0.4);
fillLight.position.set(-0.6, 0.8, -0.5);
scene.add(fillLight);

// Workbench Table & Dimensions Visualization
const table = new THREE.Mesh(
  new THREE.BoxGeometry(0.9, 0.02, 0.8),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 })
);
table.position.set(0, -0.01, 0.2);
table.receiveShadow = true;
scene.add(table);
const grid = new THREE.GridHelper(0.9, 18, 0x0284c7, 0x1e293b);
grid.position.set(0, 0.001, 0.2);
scene.add(grid);

// Physical Calibrated Workspace Boundary Perimeter in 3D
const boundGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(CONFIG.workspace.xMin, 0.002, CONFIG.workspace.zMax),
  new THREE.Vector3(CONFIG.workspace.xMax, 0.002, CONFIG.workspace.zMax),
  new THREE.Vector3(CONFIG.workspace.xMax, 0.002, CONFIG.workspace.zMin),
  new THREE.Vector3(CONFIG.workspace.xMin, 0.002, CONFIG.workspace.zMin),
  new THREE.Vector3(CONFIG.workspace.xMin, 0.002, CONFIG.workspace.zMax)
]);
const boundLine = new THREE.Line(boundGeo, new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2 }));
scene.add(boundLine);

// Target Visualizers
export const targetMarkerGroup = new THREE.Group();
targetMarkerGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 16), new THREE.MeshBasicMaterial({ color: 0x38bdf8 })));
const ring = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.017, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }));
ring.rotation.x = Math.PI / 2;
targetMarkerGroup.add(ring);
scene.add(targetMarkerGroup);

export const targetBlock = new THREE.Mesh(
  new THREE.BoxGeometry(0.035, 0.035, 0.035),
  new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3 })
);
targetBlock.position.set(0.08, 0.0175, 0.26);
targetBlock.castShadow = true;
scene.add(targetBlock);

/* =========================================================================
   ROBOT POSE APPLICATION & GRASP PHYSICS
   ========================================================================= */
export const BLOCK_REST_Y = 0.0175;

const tipPos = new THREE.Vector3();
const tarPos = new THREE.Vector3();

export function applyToolState(joints) {
  const fc = state.filteredCartesian;
  targetMarkerGroup.position.set(fc.x, fc.y, fc.z);

  toolPoint.getWorldPosition(tipPos);
  tarPos.set(fc.x, fc.y, fc.z);
  const error = tipPos.distanceTo(tarPos);

  const errLabel = document.getElementById("pos-error");
  if (errLabel) {
    errLabel.textContent = `${(error * 1000).toFixed(1)} mm`;
    errLabel.className = error < 0.005 ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold";
  }

  // Grasp Physics. joints[5] is the gripper joint in radians now, so compare
  // against a fraction of its travel rather than the old 0..1 aperture.
  const dist = tipPos.distanceTo(targetBlock.position);
  const closed = joints[5] < CONFIG.limits[5].max * 0.35;
  const dot = document.getElementById("grasp-dot");
  const text = document.getElementById("grasp-text");

  if (state.isBlockGrasped) {
    if (closed) {
      // Held rigidly. A lerp here lags behind fast transits until the gap
      // exceeds the grasp radius, silently dropping the block mid-move.
      targetBlock.position.copy(tipPos);
    } else {
      state.isBlockGrasped = false;
      dot.className = "w-2 h-2 rounded-full bg-slate-500";
      text.textContent = "Gripper Free";
    }
  } else if (dist < 0.045 && closed) {
    state.isBlockGrasped = true;
    dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
    text.textContent = "Object Grasped";
    targetBlock.position.copy(tipPos);
  } else if (targetBlock.position.y > BLOCK_REST_Y) {
    targetBlock.position.y = Math.max(BLOCK_REST_Y, targetBlock.position.y - 0.005);
  }
}

export function resizeViewport() {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

export function resetView() {
  camera.position.set(0.5, 0.45, 0.65);
  controls.target.set(0, 0.15, 0.15);
  targetBlock.position.set(0.08, 0.0175, 0.26);
  state.isBlockGrasped = false;
}
