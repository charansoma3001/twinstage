import * as THREE from "three";
import { ARM } from "./config.js";
import { loadURDF } from "./urdf.js";

/* =========================================================================
   SO-101 model: loads the URDF, orients it into the scene frame, and resolves
   wrist_roll against the real gripper frame.
   ========================================================================= */
let robot = null;
let gripperLink = null;

// Tool point: on the wrist_roll axis, level with the URDF's gripper_frame_link.
export const toolPoint = new THREE.Object3D();

const _basis = new THREE.Matrix4();

export async function loadRobot(scene) {
  robot = await loadURDF(ARM.urdfUrl);

  const holder = new THREE.Group();
  // URDF is Z-up with the arm reaching along +X; the scene is Y-up reaching
  // along +Z. Map URDF (x,y,z) -> scene (y,z,x) via an explicit basis rather
  // than guessing an Euler triple.
  _basis.makeBasis(
    new THREE.Vector3(0, 0, 1),   // URDF +X -> scene +Z
    new THREE.Vector3(1, 0, 0),   // URDF +Y -> scene +X
    new THREE.Vector3(0, 1, 0)    // URDF +Z -> scene +Y
  );
  holder.setRotationFromMatrix(_basis);
  // Put the pan axis, not base_link's origin, on the scene origin.
  holder.position.set(0, 0, -ARM.panAxisOffsetZ);
  holder.add(robot.root);
  scene.add(holder);

  gripperLink = robot.links.gripper_link;
  toolPoint.position.set(0, 0, -ARM.toolAlongRoll);
  gripperLink.add(toolPoint);

  holder.updateMatrixWorld(true);
  return robot;
}

export function isLoaded() {
  return robot !== null;
}

export function jointValues() {
  return [
    robot.joints.shoulder_pan.value,
    robot.joints.shoulder_lift.value,
    robot.joints.elbow_flex.value,
    robot.joints.wrist_flex.value,
    robot.joints.wrist_roll.value,
    robot.joints.gripper.value
  ];
}

/* Applies a full pose and refreshes world matrices, so callers reading the
   tool point's world position this frame see the pose they just set. */
export function applyPose(q, roll) {
  robot.joints.shoulder_pan.setValue(q.shoulder_pan);
  robot.joints.shoulder_lift.setValue(q.shoulder_lift);
  robot.joints.elbow_flex.setValue(q.elbow_flex);
  robot.joints.wrist_flex.setValue(q.wrist_flex);
  robot.joints.wrist_roll.setValue(roll);
  robot.joints.gripper.setValue(q.gripper);
  robot.root.updateMatrixWorld(true);
}
