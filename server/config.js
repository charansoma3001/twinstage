/* =========================================================================
   Bridge configuration, all from the environment (and an optional .env at
   the repo root; see .env.example). Nothing here is required: with no arm
   or base configured the bridge accepts commands, logs them and moves
   nothing.
   ========================================================================= */
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const PORT = Number(env.PORT || 8787);
export const DIST = path.join(here, "..", "dist");
export const DRIVERS_DIR = path.join(here, "..", "drivers");

/* SO-101 arms. ARM_PORT is the follower, LEADER_PORT the leader; ARM_DRY
   applies to both. */
export const ARM_DRY = env.ARM_DRY === "1";
// The interpreter needs LeRobot installed: activate its venv or point ARM_PYTHON at it.
export const ARM_PYTHON = env.ARM_PYTHON || "python3";
export const ARM_SCRIPT = path.join(DRIVERS_DIR, "so101_arm.py");
export const ARM_CONFIG = {
  follower: {
    port: env.ARM_PORT || null,
    portVar: "ARM_PORT",
    id: env.ARM_ID || "follower",
    map: path.join(DRIVERS_DIR, "joint_map.json"),
    calibrationDir: null,
    startRelaxed: false,
    dryPresent: env.FOLLOWER_DRY_PRESENT || null
  },
  leader: {
    port: env.LEADER_PORT || null,
    portVar: "LEADER_PORT",
    id: env.LEADER_ID || "leader",
    map: path.join(DRIVERS_DIR, "joint_map_leader.json"),
    // The leader was calibrated as a teleoperator, so its file lives there.
    calibrationDir: env.LEADER_CAL_DIR ||
      path.join(os.homedir(), ".cache", "huggingface", "lerobot", "calibration", "teleoperators", "so_leader"),
    startRelaxed: true,
    dryPresent: env.LEADER_DRY_PRESENT || null
  }
};

/* LeKiwi base. BASE_HOST is an ssh destination (e.g. pi@lekiwi.local): the
   driver is sent over ssh and runs on the base's Pi. BASE_DRY=1 runs it here
   instead, integrating commands and touching no hardware. */
export const BASE = {
  host: env.BASE_HOST || null,
  dry: env.BASE_DRY === "1",
  python: env.BASE_PYTHON || "~/lerobot/.venv/bin/python",
  localPython: env.BASE_LOCAL_PYTHON || "python3",
  serial: env.BASE_SERIAL || "/dev/ttyACM0",
  script: path.join(DRIVERS_DIR, "lekiwi_base.py"),
  // Unique on the Pi, so a driver orphaned by a dropped ssh link can be found.
  tag: "twinstage:lekiwi_base"
};
