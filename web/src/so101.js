import * as THREE from "three";
import { ARM } from "./config.js";

/* =========================================================================
   SO-101 in the scene frame.

   The URDF is Z-up with the arm reaching along +X; the scene is Y-up reaching
   along +Z. mountSO101 maps URDF (x,y,z) -> scene (y,z,x) through an explicit
   basis rather than a guessed Euler triple, puts the pan axis (not
   base_link's origin) on the holder's origin, and hangs the tool point off
   the gripper: on the wrist_roll axis, level with gripper_frame_link.
   ========================================================================= */
export const JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"];
export const BODY_JOINTS = JOINTS.slice(0, 5);

const BASIS = new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1),   // URDF +X -> scene +Z
  new THREE.Vector3(1, 0, 0),   // URDF +Y -> scene +X
  new THREE.Vector3(0, 1, 0)    // URDF +Z -> scene +Y
);

export function mountSO101(robot, toolPoint = new THREE.Object3D()) {
  const holder = new THREE.Group();
  holder.setRotationFromMatrix(BASIS);
  holder.position.set(0, 0, -ARM.panAxisOffsetZ);
  holder.add(robot.root);

  toolPoint.position.set(0, 0, -ARM.toolAlongRoll);
  robot.links.gripper_link.add(toolPoint);

  holder.updateMatrixWorld(true);
  return { holder, toolPoint };
}

/* q: six joint values in JOINTS order, URDF radians. */
export function setJoints(robot, q) {
  JOINTS.forEach((j, i) => robot.joints[j]?.setValue(q[i]));
}

export function jointValues(robot) {
  return JOINTS.map((j) => robot.joints[j].value);
}

/* Body in `colour`, servos dark: how every twin is drawn. */
export function paintSO101(robot, colour) {
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
