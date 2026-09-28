# SO-101 Overhead Retargeting Studio

Vite app. 4-corner homography hand retargeting → SO-101 IK → three.js sim, with an optional WebSocket bridge to a robot backend.

Two pages:

- **`/` — the stage.** The big-screen page for demos: a twin of the leader and
  follower, the hand camera with both skeletons, the follower's camera, and the
  LeKiwi base view. Everything that is set once per rig lives on the other page.
- **`/settings` — the studio.** 4-corner calibration, mirror/invert toggles,
  camera roles, which hand drives which arm, the per-arm joint maps, sliders
  and demo routines.

## The two-arm demo

```sh
# dry run first, both arms, every time
ARM_PORT=/dev/tty.usbmodemF... LEADER_PORT=/dev/tty.usbmodemL... ARM_DRY=1 npm run server

# live
npm run build
ARM_PORT=/dev/tty.usbmodemF... LEADER_PORT=/dev/tty.usbmodemL... npm run server
# optional: BASE_HOST=pi@lekiwi.local for the LeKiwi base, LEADER_ID (default "leader")
```

The bridge holds one mode, switched from the stage's header:

| mode | leader | follower | who commands |
|---|---|---|---|
| idle | as it was | holds | nobody |
| **Teleop** | torque off, read at 50 Hz | copies the leader's reading | the leader, by hand |
| **Hands** | powered | powered | the stage: each hand drives one arm |
| **Primitives** | powered | powered | the stage: task primitives on the leader, the follower or both |
| manual | per the settings page | per the settings page | the settings page (it takes this mode when it links) |

Hands → Teleop turns the leader's torque off, so the bridge freezes both arms
and counts down three seconds first ("Hold the leader"). STOP (or Esc) on the
stage freezes both arms where they are and stops the base; it does not drop
anything. The settings page's Relax still cuts torque on every arm.

**Before Hands can run live, the leader needs its own joint map.** Settings →
Telemetry → Joint Map → **Leader**, mirror, match the render, Save. It is
written to `drivers/joint_map_leader.json`; until it exists the bridge refuses
Hands mode. The leader is driven through the same `so101_arm.py`, with its
teleoperator calibration (`--calibration-dir .../teleoperators/so_leader`)
and every guard below. It is a leader: several joints are geared differently
from the follower's, so it is weaker and less precise under power.

**Two hands, one camera.** Each hand works the whole calibrated table, mapped
over its own arm's full workspace; the arms stand far enough apart that giving
each hand half the table only halved its travel. By default the left hand
drives the leader and the right the follower; the stage's Swap button (or
Settings → Leader: right hand) swaps them. The Hands card's **Follower | Both**
selector picks whether one hand drives the follower alone (the leader holds
still) or both hands drive both arms; switching is instant, because MediaPipe
always looks for up to two hands and the choice only routes its results.
Hands are told apart by MediaPipe's handedness label. A top-down camera can
report those swapped, which Settings → Hand labels: flipped corrects. If both
hands come back with the same label, their position on the table decides.
Each skeleton on the stage is coloured for the arm it drives, so a swap is
visible before anything moves.

Camera roles (hand camera, follower camera) are chosen on the settings page
and stored in the browser; open settings in another tab and the stage picks
up changes without a reload.

## Run

```bash
npm install
npm run dev          # frontend on http://localhost:5173
npm run server       # bridge on http://localhost:8787 (optional)
npm start            # both
```

Build: `npm run build` → `dist/` (the bridge server also serves `dist/` if present).

## Layout

```
index.html            the stage page
settings.html         the studio page (was index.html)
src/stage/            stage: main.js, twin.js (two arms), hands.js (two-hand tracking), keepout.js, link.js
src/primitives.js     task primitives (rest, pick & place, pinch, wave), shared by both pages
src/settingsMain.js   studio entry point
src/prefs.js          camera roles + hand-to-arm prefs, shared by both pages
src/stageSetup.js     the studio's Cameras & hands panel
src/baseTwin.js       LeKiwi twin, used by the stage
src/config.js         link lengths, joint limits, workspace, calibration defaults
src/state.js          single mutable app state object
src/kinematics.js     solveSO101IK — analytic IK, untouched
src/retarget.js       inverse-bilinear homography + landmark → cartesian mapping
src/scene.js          three.js scene, table, target marker, grasp physics
src/urdf.js           minimal URDF reader (links, joints, STL visuals)
src/robot.js          loads the SO-101 URDF, poses it, solves wrist_roll
src/tracking.js       MediaPipe Hands (CDN, lazy), canvas overlays, hand skeleton
src/calibration.js    4-corner wizard, mirror/invert toggles
src/ui.js             sliders, labels, mode switcher, servo telemetry
src/demo.js           autonomous routines
src/robotLink.js      studio WebSocket client (off by default; "Bridge" button; linking takes manual mode)
server/index.js       bridge + arm driver supervisor
bridge/so101_arm.py   LeRobot SO101Follower driver (stdin JSON -> servos), follower and leader
drivers/jog.py         measures the sim -> arm sign/offset map
drivers/scan.py        read-only bus scan: pings every servo, moves nothing
drivers/joint_map.json the follower's measured map; identity until it exists
drivers/joint_map_leader.json  the leader's; Hands mode refuses to run live without it
src/armTwin.js        mirror mode + offset sliders (the measuring instrument)
```

MediaPipe ships UMD-only bundles that neither Vite nor Rollup can unwrap into ES
exports, so `tracking.js` injects `hands.js` / `camera_utils.js` from jsDelivr on
the first switch to Live Camera and reads the globals — same source and versions
the prototype used. Nothing is fetched until the camera is actually requested.

The retargeting math (`retarget.js`), IK (`kinematics.js`) and the animation loop are
copied verbatim from the prototype — same numbers, same per-frame work.

## Driving the real SO-101

The bridge owns the arm driver: give it `ARM_PORT` and it spawns
`bridge/so101_arm.py` under the LeRobot venv and pipes the joint stream in as
newline JSON. The driver dies with the bridge, so a dead bridge cannot leave a
torque-enabled arm behind.

```bash
# once, in ~/Repos/lerobot -- the Feetech SDK is behind an extra
uv sync --extra feetech

# 1. dry run: prints the degrees it would send, touches nothing
ARM_PORT=/dev/cu.usbmodemXXXX ARM_DRY=1 npm run server

# 2. measure the sim <-> arm joint map in the studio: Telemetry tab ->
#    Mirror Real Arm -> drag the offsets until the render matches -> Save Map.
#    This needs the live arm, so drop ARM_DRY for it.
#
#    Non-visual fallback (keep the bridge in ARM_DRY=1 so jog.py can own the
#    serial port; the studio must be Linked so it can read /api/state):
npm run jog -- --port /dev/cu.usbmodemXXXX

# 3. live
ARM_PORT=/dev/cu.usbmodemXXXX npm run server
```

`ARM_ID` picks the LeRobot calibration (default `follower`, i.e.
`~/.cache/huggingface/lerobot/calibration/robots/so_follower/follower.json`),
and `ARM_PYTHON` overrides the interpreter (default `~/Repos/lerobot/.venv/bin/python`).

### The joint map

Studio joints are the URDF's radians. The arm reports LeRobot's calibrated
degrees, whose zero is the **midpoint of the range swept during calibration** --
a pose with no relationship to the URDF's zero. So

    arm_deg = sign * sim_deg + offset

and both terms have to be measured. The offset because the two zeros are
unrelated (`homing_offset` does not enter the conversion at all -- see
`MotorsBus._normalize`); the sign because whether a servo's positive direction
matches the URDF's joint axis depends on how it is physically mounted, which
software cannot see.

**Measure it with the render, in the Telemetry tab.** Link the bridge, press
*Mirror Real Arm* (which cuts torque and starts present-position telemetry),
pose the arm by hand, and drag each joint's offset until the on-screen arm
matches the one in front of you. Check three poses -- folded, forearm level,
arm upright -- because an offset that fits one pose can still be wrong. *Save
Map* writes `drivers/joint_map.json`; restart the bridge to load it.

This is deliberately a picture-to-arm comparison with no algebra in between.
The `evolve-ai` project measured the same map twice by fitting to poses judged
by eye -- spirit-level readings, then an FK-straightness optimisation with
1.6 mm residuals -- and both were confidently ~15 deg wrong, because *a tight
fit to a mis-judged pose looks exactly like a good answer*. Its conclusions
that do carry over: all six signs came out +1 on that arm (`drive_mode` is 0
throughout), and an offset can never compensate for a flipped axis, so a wrong
sign shows up as a folded, physically impossible arm rather than a small error.

`drivers/jog.py` is the non-visual fallback: the arm goes limp, you match the
sim at several poses by hand, and it least-squares fits sign and offset per
joint, reporting spread, residual and the free slope. Treat its output as a
starting point for the sliders, not as the answer -- with few or narrow poses
it will report a sign it has not actually measured, and it says so when the
spread is under 15 deg.

### When the driver will not connect

`Failed to write 'Torque_Enable' on id_=3 ... There is no status packet!` does
not distinguish a genuinely unreachable servo from a single dropped packet on
a freshly-opened USB serial adapter, and LeRobot's torque-enable does not
retry. `python drivers/scan.py <port>` pings every id read-only: if they all
answer, it was a dropped packet and the driver's connect retry (three
attempts, 0.6 s apart) will ride over it. If one id stays silent there, look
at that servo's cable, power and id.

### When an arm drops off the bus

"There is no status packet!" is a single missed reply from a servo, not a
disconnected cable: LeRobot reads every servo back before each write (its
`max_relative_target` clamp), so each arm does 50 read-backs a second, and on
a busy bus one occasionally goes missing. The driver now retries: a missed
packet is logged and the same goal is sent again on the next tick. Only 0.5 s
of back-to-back failures (`--bus-error-s`) counts as the bus being gone; the
driver then exits with code 5 and a `bus lost` error instead of a traceback.

The bridge restarts a driver that exits on its own after 1 s, then 2, 3, 4,
5 s, and stops trying after five failures in a minute, when the stage shows
"Lost: check cable". A restart drops the mode to idle, so choose Teleop or
Hands again once the arm reads "Holding". Measured against a fake bus: 20%
packet loss ran for 4 s without exiting (31 recoveries); a bus that stopped
answering was given up on 0.56 s later.

### Latency, measured

A `Present_Position` read of all six servos takes 1.00 ms (p50, 1.18 ms p95)
on either arm, 1.2 ms with both buses running at 50 Hz, with no drops in
2,000 idle reads (read-only bench, torque untouched). So:

- Teleop reads the leader every 20 ms tick (50 Hz). The old 30 Hz setting
  actually delivered ~25 Hz: the telemetry test skipped every other tick.
  Readings now run on a fixed schedule and arrive at the rate asked for.
- LeRobot's `max_relative_target` read-back is left on. It costs ~1 ms of
  each 20 ms tick, so turning it off would buy almost no latency and remove
  one of two overlapping guards.
- Each driver logs `loop p50/p95 ms, bus p50/p95 ms, overruns, bus errors`
  every 5 s, so a change can be checked against a number.
- Hand tracking is MediaPipe Tasks (`HandLandmarker`, `@mediapipe/tasks-vision`)
  on the GPU, on the page's thread, loaded from `public/mediapipe/` (runtime
  + 7.8 MB model, Apache-2.0): no CDN, works offline. Both pages use it, so a
  calibration captured in `/settings` measures palms as the stage reads them.
  Measured on the demo laptop (M1, Chrome 153, one hand in view):

  | setup | per frame | tracking | page |
  |---|---|---|---|
  | legacy `@mediapipe/hands`, page thread | 70 ms | 13 fps | 15 fps |
  | Tasks in a worker, GPU | 295 ms | 3 fps | 60 fps |
  | Tasks in a worker, CPU | 110 ms | 9 fps | 60 fps |
  | Tasks on the page, twin at 1.8x | 100 ms | 10 fps | 10 fps |
  | **Tasks on the page, twin at 1x** | **53 ms** | **17-18 fps** | **20 fps** |

  A worker frees the page but Chrome gives it a slow GPU path; the arms need
  the tracking rate more than the page needs 60 fps. The twin shares the GPU,
  so the stage draws it at 1x while the hand camera is active and at full
  sharpness in Teleop and Primitives. Capture size made no difference to
  speed (640x480 vs 1280x720, 46-62 ms either way); 640x480 is kept because
  it is what `/settings` calibrates at.
- **Recalibrate after this change.** The Tasks model measures palm size a
  little differently from the legacy one, and the height mapping is built on
  palm size: recapture the table and hover corners in `/settings`.

The per-joint slew limit (`--max-deg-per-s`, 60) is the largest latency in
the chain by far and is unchanged: a 30 degree move takes 0.5 s.

### What keeps it safe

| guard | where | effect |
|---|---|---|
| slew limit | `--max-deg-per-s`, default 60 | every joint ramps; the first frame is approached from the arm's real present position, not snapped to |
| travel clamp | derived from your calibration, `--margin-deg` | commands stay inside the range you actually swept, held 3 deg off the ends |
| `max_relative_target` | LeRobot, default 8 | per-step clamp against the arm's own measured position |
| watchdog | `--watchdog`, default 0.75 s | a stalled or dropped stream freezes the pose instead of chasing a stale one |
| Relax / Esc | studio header | cuts torque immediately; press again to re-enable holding the present pose |
| exit | driver `finally` | `disable_torque_on_disconnect` relaxes the arm at its last commanded pose |

## Driving the LeKiwi base

The base's Pi runs `drivers/lekiwi_base.py`. The bridge sends it over `ssh` on
every start, so nothing is installed or kept in sync on the Pi beyond the
lerobot venv that is already there. The driver opens a motor bus holding only
the three wheels (IDs 7-9); the arm on the same bus is never addressed.

```sh
# 1. dry run on the Pi: proves ssh, the network and the phone page, no motors
BASE_HOST=pi@lekiwi.local BASE_DRY=1 npm run server

# 2. live (build first so the bridge can serve the app and the phone page)
npm run build
BASE_HOST=pi@lekiwi.local npm run server                 # base only
ARM_PORT=/dev/tty.usbmodem... BASE_HOST=pi@lekiwi.local npm run server   # arm and base
```

`BASE_DRY=1` without `BASE_HOST` runs the driver on the laptop instead.

- **Laptop:** open `http://localhost:8787`, switch the header to **Base**.
  Arrow keys drive and turn, A/D strafe, Space or Esc stops.
- **Phone:** the bridge prints `phone drive page: http://<ip>:8787/drive` at
  startup. Phone and laptop must be on the same network. A phone hotspot
  works; venue Wi-Fi often blocks device-to-device traffic. macOS may ask
  once whether to accept incoming connections to `node`.

One controller drives at a time: whoever is holding a direction owns the base
until they have been idle for a second, and the other sees "Someone else is
driving". Stop works from anywhere.

The twin's pose is wheel odometry and it drifts: omniwheels slip. The floor is
an endless grid that follows the base, so there is nothing for the drift to
be wrong against. Reset clears the odometry and the trail. The arm on the base
is drawn at the URDF's zero pose; its live joints are not shown, because its
calibration zero has not been measured against the URDF (the same problem the
SO-101 joint map solves).

The model is [SIGRobotics-UIUC/LeKiwi](https://github.com/SIGRobotics-UIUC/LeKiwi)'s
URDF (Apache-2.0, `public/urdf/LeKiwi/LICENSE.txt`). The three omniwheel STLs
were decimated from 314k to 12k faces (15.7 MB to 0.6 MB each) so the page
loads quickly.

### What keeps the base safe

| guard | where | effect |
|---|---|---|
| speed cap | `--max-lin` 0.25 m/s, `--max-rot` 60 deg/s | full stick is this, and lerobot's 3000-tick wheel cap still applies |
| ramp | `--lin-accel` 0.5, `--lin-decel` 1.5 m/s^2 | starts are gentle; stopping is three times quicker than starting |
| hold to move | browser and phone | every input sends zero when released; blur, hidden tab and page-hide stop |
| owner disconnect | bridge | a driving client's socket closing stops the base at once |
| watchdog | driver on the Pi, `--watchdog` 0.4 s | no drive command for 0.4 s and the goal is zero, whatever the network did |
| link timeout | driver, `--link-timeout` 5 s | no line at all from the bridge (it pings every 1 s) and the driver exits, freeing the port |
| exit | driver `finally`, including on SIGTERM/SIGHUP | wheels zeroed, then their torque off so the base can be pushed |

The servos hold their last velocity until told otherwise. A driver killed with
SIGKILL, or a Pi that loses power, skips the exit path. Every other way of
stopping it has been exercised in dry run.

## Bridge protocol

Client → server, ~50 Hz, only while connected:

```json
{ "t": 12345.6,
  "joints": [j1, j2, j3, j4, j5, gripper],
  "cartesian": { "x": 0, "y": 0.22, "z": 0.24, "pitch": -0.26, "roll": 0, "gripper": 0.8 } }
```

Joints are radians in the URDF's convention -- including index 5, the gripper,
which is its joint angle over 0..1.74533 rad rather than a 0..1 aperture. The
studio also sends `{"cmd": "relax"}` / `{"cmd": "hold"}` from the header button.
Override the endpoint with `VITE_BRIDGE_URL`.

Server -> client: `{"type": "arm", ...}` frames mirror whatever the driver
reports (`ready`, `status`, `log`, `error`).

Base, client -> server: `{"cmd": "drive", "x", "y", "w"}` as fractions of the
speed cap in -1..1 (x forward, y left, w counter-clockwise), sent at 20 Hz
while held and once as zero on release; `{"cmd": "base_stop"}`;
`{"cmd": "base_reset_odom"}`. Server -> client: `{"type": "base", "kind": ...}`
with `kind` one of `ready`, `odom` (`pose` [x m, y m, heading deg], `vel`,
`cmd`, `wheels` rad, `stale`), `log`, `error`, `exit`, `busy`.
