// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { parseURDF } from "../src/urdf.js";
import { WHEEL_SPIN_SIGN } from "../src/baseTwin.js";

/* The base twin's wheels must roll the way the base moves. Each wheel's spin
   comes from the driver (LeRobot's kinematics, as in drivers/lekiwi_base.py
   and the dry run in src/sim/simDrivers.js); rolling without slip along the
   floor fixes what it has to be, given the wheel's axle in the rendered model. */
const URDF = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/urdf/LeKiwi/LeKiwi.urdf");
const WHEELS = ["base_left_wheel", "base_back_wheel", "base_right_wheel"];
const WHEEL_RADIUS = 0.05, BASE_RADIUS = 0.125;
const WHEEL_ANGLES = [240, 0, 120].map((a) => (a - 90) * Math.PI / 180);
const driverSpin = (vx, vy, wz) =>
  WHEEL_ANGLES.map((a) => (Math.cos(a) * vx + Math.sin(a) * vy + BASE_RADIUS * wz) / WHEEL_RADIUS);

function mountedWheels() {
  const model = parseURDF(readFileSync(URDF, "utf8"));
  // As baseTwin.js mounts it.
  const holder = new THREE.Group();
  holder.setRotationFromMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
  holder.add(model.root);
  holder.updateMatrixWorld(true);
  const wheels = WHEELS.map((name) => {
    const rot = model.joints[name].rot;
    const q = rot.getWorldQuaternion(new THREE.Quaternion());
    return { axis: model.joints[name].axis.clone().applyQuaternion(q), pos: rot.getWorldPosition(new THREE.Vector3()) };
  });
  const centre = wheels.reduce((c, w) => c.add(w.pos), new THREE.Vector3()).multiplyScalar(1 / 3);
  for (const w of wheels) w.pos.sub(centre).setY(0);
  return wheels;
}

describe("base twin wheels", () => {
  const wheels = mountedWheels();
  const down = new THREE.Vector3(0, -1, 0);
  // The twin puts forward (x) on +Z, left (y) on +X, and turns left about +Y.
  for (const [motion, vx, vy, wz] of [["forward", 0.2, 0, 0], ["strafing left", 0, 0.2, 0], ["turning left", 0, 0, 1]]) {
    it(`roll the way the base moves when ${motion}`, () => {
      const shown = driverSpin(vx, vy, wz).map((s) => WHEEL_SPIN_SIGN * s);
      wheels.forEach((w, i) => {
        const v = new THREE.Vector3(vy, 0, vx).add(new THREE.Vector3(0, wz, 0).cross(w.pos));
        const roll = w.axis.clone().cross(down);   // contact point's velocity per unit spin, over R
        const needed = -v.dot(roll) / (WHEEL_RADIUS * roll.lengthSq());
        if (Math.abs(needed) < 1e-6) return;
        expect(Math.sign(shown[i]), WHEELS[i]).toBe(Math.sign(needed));
        // Translation fixes the size too; turning depends on where each
        // wheel's joint sits, so only its direction is checked.
        if (!wz) expect(shown[i]).toBeCloseTo(needed, 2);
      });
    });
  }
});
