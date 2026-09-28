import * as THREE from "three";
import { ARM } from "./config.js";
import { loadURDF } from "./urdf.js";
import { mountSO101, paintSO101, setJoints, jointValues as so101JointValues } from "./so101.js";

/* =========================================================================
   SO-101 model: loads the URDF, orients it into the scene frame, and resolves
   wrist_roll against the real gripper frame.
   ========================================================================= */
let robot = null;

// Tool point: on the wrist_roll axis, level with the URDF's gripper_frame_link.
export const toolPoint = new THREE.Object3D();

export async function loadRobot(scene) {
  robot = await loadURDF(ARM.urdfUrl);
  paintSO101(robot, 0xfe5e0e);
  scene.add(mountSO101(robot, toolPoint).holder);
  return robot;
}

export function jointValues() {
  return so101JointValues(robot);
}

/* Applies a full pose and refreshes world matrices, so callers reading the
   tool point's world position this frame see the pose they just set. */
export function applyPose(q, roll) {
  setJoints(robot, [q.shoulder_pan, q.shoulder_lift, q.elbow_flex, q.wrist_flex, roll, q.gripper]);
  robot.root.updateMatrixWorld(true);
}
