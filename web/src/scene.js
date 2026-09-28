import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CONFIG } from "./config.js";
import { state } from "./state.js";
import { toolPoint } from "./robot.js";
import { addLights, addFloor, createRenderer } from "./ui/sceneLook.js";

/* =========================================================================
   THREE.JS 3D SCENE SETUP & CALIBRATED WORKBENCH
   ========================================================================= */
export const container = document.getElementById("canvas-container");

export const scene = new THREE.Scene();

export const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.01, 10);
camera.position.set(0.62, 0.5, 0.82);

export const renderer = createRenderer(container);
renderer.setSize(container.clientWidth, container.clientHeight);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.14, 0.12);
controls.maxPolarAngle = Math.PI / 2 - 0.05;

addLights(scene);
addFloor(scene, 1.2);

// Physical Calibrated Workspace Boundary Perimeter in 3D
const boundGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(CONFIG.workspace.xMin, 0.002, CONFIG.workspace.zMax),
  new THREE.Vector3(CONFIG.workspace.xMax, 0.002, CONFIG.workspace.zMax),
  new THREE.Vector3(CONFIG.workspace.xMax, 0.002, CONFIG.workspace.zMin),
  new THREE.Vector3(CONFIG.workspace.xMin, 0.002, CONFIG.workspace.zMin),
  new THREE.Vector3(CONFIG.workspace.xMin, 0.002, CONFIG.workspace.zMax)
]);
// The table area the hand calibration maps onto.
const boundLine = new THREE.Line(boundGeo, new THREE.LineBasicMaterial({ color: 0xfe5e0e }));
scene.add(boundLine);

// Target Visualizers
export const targetMarkerGroup = new THREE.Group();
targetMarkerGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 16), new THREE.MeshBasicMaterial({ color: 0x000b1a })));
const ring = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.017, 24), new THREE.MeshBasicMaterial({ color: 0x000b1a, side: THREE.DoubleSide }));
ring.rotation.x = Math.PI / 2;
targetMarkerGroup.add(ring);
scene.add(targetMarkerGroup);

export const targetBlock = new THREE.Mesh(
  new THREE.BoxGeometry(0.035, 0.035, 0.035),
  new THREE.MeshStandardMaterial({ color: 0xfebe42, roughness: 0.35 })
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
    // Over 5 mm the target is out of reach and the tool stops short of it.
    errLabel.parentElement.dataset.tone = error < 0.005 ? "off" : "warn";
  }

  // Grasp Physics. joints[5] is the gripper joint in radians now, so compare
  // against a fraction of its travel rather than the old 0..1 aperture.
  const dist = tipPos.distanceTo(targetBlock.position);
  const closed = joints[5] < CONFIG.limits[5].max * 0.35;
  const grasp = document.getElementById("grasp-text");

  if (state.isBlockGrasped) {
    if (closed) {
      // Held rigidly. A lerp here lags behind fast transits until the gap
      // exceeds the grasp radius, silently dropping the block mid-move.
      targetBlock.position.copy(tipPos);
    } else {
      state.isBlockGrasped = false;
      grasp.textContent = "Gripper free";
      grasp.dataset.tone = "off";
    }
  } else if (dist < 0.045 && closed) {
    state.isBlockGrasped = true;
    grasp.textContent = "Holding the block";
    grasp.dataset.tone = "sun";
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
  camera.position.set(0.62, 0.5, 0.82);
  controls.target.set(0, 0.14, 0.12);
  targetBlock.position.set(0.08, 0.0175, 0.26);
  state.isBlockGrasped = false;
}
