# Adding a robot

Twinstage was built around the SO-101, and the arm is still assumed in a few places. This page lists every one, so you can see what supporting another arm takes before you start. If you are planning one, open an issue first; we would like to help it land.

## What is assumed today

An arm is six named joints: `shoulder_pan`, `shoulder_lift`, `elbow_flex`, `wrist_flex`, `wrist_roll`, `gripper`. The first rotates about a vertical axis, the next three pitch in the plane it swings, then the wrist rolls, then the gripper opens. The joint map, the drivers' protocol and the bridge's validation all use those names.

| Where | What is SO-101 specific |
|---|---|
| `drivers/so101_arm.py` | Talks to the arm through LeRobot's `SO101Follower`. |
| `web/public/urdf/SO101/` | The model the twin draws and the kinematics are measured from. |
| `web/src/config.js` | Joint limits, the workspace, and `ARM`: the link lengths and zero-pose angles the inverse kinematics uses, each measured off the URDF. |
| `web/src/kinematics.js` | An analytic solver for exactly that shape: a pan joint, then three pitch joints in one plane. |
| `web/src/so101.js` | How the URDF's axes map onto the scene's, and where the tool point sits. |
| `web/src/so101-hull.json` | The arm's physical extent, generated from its meshes, for the keep-out. |

## An arm of the same shape

Arms with a pan joint, three pitch joints and a wrist roll, like the SO-100 or Koch, need no new code on the page, only new numbers:

1. **The URDF.** Put it and its meshes under `web/public/urdf/<Arm>/`, and point `ARM.urdfUrl` at it.
2. **The geometry.** Re-measure `ARM` in `web/src/config.js` from the new URDF: the shoulder's offset from the pan axis, the three link lengths, and each link's heading at the zero pose. The comment above `ARM` shows how the SO-101's were derived. Update the joint limits from the URDF too.
3. **The mounting.** If the URDF's axes differ from the SO-101's (X forward, Z up), change the basis in `web/src/so101.js`, and the tool point's distance along the wrist roll axis (`ARM.toolAlongRoll`).
4. **The hull.** Point `scripts/build-so101-hull.mjs` at the new URDF and run `npm run build:hull`.
5. **The driver.** Copy `drivers/so101_arm.py`, and swap `SO101Follower` for the LeRobot class of your arm. Everything else in it (the protocol, the joint map, the clamps, the slew, the watchdog) stays as it is.
6. **The tests.** Point the tests in `web/test/` at the new URDF. They check the solver against the URDF over the whole workspace, and the keep-out against the meshes; they are how you know the numbers in step 2 are right.

## A different shape

A 6- or 7-joint arm, or one whose pitch joints are not in one plane, needs a new solver. Keep its signature: `solve(target)` takes `{x, y, z, pitch, roll, gripper}` in the scene's frame and returns the joint values, plus `unreachable` when no pose reaches the target. Then the retargeting, primitives, keep-out and twin work unchanged. A numeric solver over the URDF is the simplest start.

The joint names are the harder part. The bridge, the joint map and the driver protocol would need a list of joints from the arm, rather than the fixed six. That is a worthwhile change; open an issue so it can be designed once for every arm.

## A new driver for anything

The bridge does not care what is on the other end of a driver's stdin and stdout, as long as it speaks the [driver protocol](protocol.md#bridge-and-driver). A driver for a simulator, a different servo bus or a network robot only has to:

- print `ready` once connected, then `status` a few times a second;
- accept `joints` goals, and enforce its own limits on them;
- hold its pose when goals stop arriving;
- print `present` readings while telemetry is on;
- exit when stdin closes.

`drivers/tests/test_so101_arm.py` shows how to test those against the real process.
