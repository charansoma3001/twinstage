# Protocol

Two protocols, both JSON: pages talk to the bridge over one WebSocket, and the bridge talks to each driver with one JSON object per line on the driver's stdin and stdout. Use this page to write your own client (a VR headset, a gamepad, a script) or your own driver.

## Browser and bridge

Connect a WebSocket to the bridge's port, `ws://localhost:8787` by default. Every message is one JSON object. Frames that do not parse are dropped.

### Bridge to client

On connecting, the bridge sends a snapshot:

```json
{
  "type": "hello",
  "hz": 50,
  "robot": "so-101",
  "arms": {
    "follower": { "spawned": true, "ready": true, "dryRun": false, "relaxed": false, "identityMap": false, "live": true, "port": "/dev/tty.usbmodem...", "id": "follower", "last": { "...": "the driver's last status" } },
    "leader": { "...": "the same" }
  },
  "arm": { "...": "the follower again, under its old key" },
  "mode": { "type": "mode", "mode": "idle", "note": "", "pending": null },
  "base": { "spawned": true, "ready": true, "dryRun": true, "host": null, "live": false, "last": { "...": "the last odometry" } },
  "phoneUrls": ["http://192.168.1.20:8787/drive"]
}
```

After that:

| Message | When |
|---|---|
| `{"type": "mode", "mode", "note", "pending"}` | The mode changed. `pending` is `{"mode": "teleop", "at": <epoch ms>}` during the countdown before the leader goes limp. |
| `{"type": "mode", ..., "refused": "<why>"}` | Sent only to the client whose request was refused. |
| a driver's own frame, with `"arm": "follower"` or `"leader"` | Everything an arm driver prints is forwarded, keeping its own `type`: `ready`, `status`, `present`, `timing`, `log`, `error`. See [driver output](#driver-output). |
| `{"type": "arm", "kind": "exit", "code", "arm"}` | An arm's driver exited. |
| `{"type": "arm", "kind": "restarting", "in": <ms>, "arm"}` | The bridge will restart it. |
| `{"type": "arm", "kind": "gave_up", "arm"}` | It died five times in a minute; the bridge stopped trying. |
| `{"type": "base", "kind": "<type>", ...}` | Everything the base driver prints, with its `type` moved to `kind`: `ready`, `odom`, `log`, `error`, and `exit` from the bridge. |
| `{"type": "base", "kind": "busy"}` | Sent only to a client whose drive was refused because someone else is driving. |
| `{"type": "log", "msg"}` | A message from the bridge itself. |

### Client to bridge

| Message | What it does |
|---|---|
| `{"cmd": "mode", "mode": "<idle\|teleop\|hands\|primitive\|manual>", "note"}` | Ask for a mode. The bridge may refuse; see [modes](modes.md). |
| `{"cmd": "freeze"}` | STOP: every arm holds where it is, and the mode drops to idle. |
| `{"cmd": "relax", "arm"}`, `{"cmd": "hold", "arm"}` | Torque off, or on holding the present pose. `arm` is `follower` (the default), `leader` or `all`. |
| `{"cmd": "telemetry", "arm", "on": true, "hz": 20}` | Start or stop that arm's `present` readings. `hz` is optional, up to 60. |
| `{"joints": [six numbers], "arm", "src": "stage"}` | A joint goal, in URDF radians (see [architecture](architecture.md#units-at-each-boundary)). It reaches the arm only if the mode allows `src`: `stage` in hands and primitive, `studio` in manual. Send steadily (the stage sends 50 a second); after 0.75 s with none, the driver's watchdog holds the arm. |
| `{"cmd": "drive", "x", "y", "w"}` | Drive the base, as fractions of the speed cap from -1 to 1: `x` forward, `y` left, `w` counter-clockwise. Send about 20 times a second while held, and zero once on release. |
| `{"cmd": "base_stop"}` | Stop the base. Accepted from anyone. |
| `{"cmd": "base_reset_odom"}` | Put the base's odometry back at the origin. |

### HTTP

| Route | |
|---|---|
| `GET /api/health` | The same snapshot as `hello`, plus `"ok": true` and a command count. |
| `GET /api/state` | The last forwarded joint command, and how many there have been. |
| `GET /api/joint-map?arm=follower` | That arm's saved joint map, or `null`. |
| `POST /api/joint-map?arm=follower` | Save a joint map. Each body joint needs `sign` of 1 or -1 and a finite `offset_deg`. Restart the bridge for the driver to load it. |
| `/`, `/settings`, `/drive` | The pages, from the build in `dist/`. |

## Bridge and driver

The bridge starts each driver as a child process and speaks to it on stdin and stdout, one JSON object per line. stderr is left to the terminal, so tracebacks show up where you started the bridge. Lines on stdout that are not JSON are logged as they are.

### Arm driver input

| Line | What it does |
|---|---|
| `{"cmd": "joints", "j": [six numbers]}` | A goal in URDF radians. The driver maps it through the joint map, clamps it to travel and slews towards it. |
| `{"cmd": "joints_deg", "pos": {"shoulder_pan": ..., "gripper": ...}}` | A goal already in LeRobot units. Used for teleop; only the travel clamp and slew apply. |
| `{"cmd": "relax"}`, `{"cmd": "hold"}` | Torque off; torque on, holding where it is. |
| `{"cmd": "telemetry", "on": true, "hz": 20}` | Start or stop `present` readings. |

Only the newest goal counts. A backlog of old goals is dropped, not replayed.

### Driver output

| Line | |
|---|---|
| `{"type": "ready", "dry_run", "port", "id", "relaxed", "identity_map", "limits": {"shoulder_pan": [lo, hi], ...}, "present": {...}}` | Connected. `limits` is the travel it will clamp to. `identity_map` is true when no joint map was found. |
| `{"type": "status", "mode", "relaxed", "stale", "command": {...}}` | Four times a second. `stale` means the watchdog is holding. |
| `{"type": "present", "pos": {...}}` | The arm's measured position, in LeRobot units, while telemetry is on. Dry runs add `"dry_run": true` and report the simulated pose. |
| `{"type": "timing", "budget_ms", "loop_p50", "loop_p95", "bus_p50", "bus_p95", "overruns", "bus_errors"}` | Every five seconds. See [performance](performance.md). |
| `{"type": "log", "msg"}`, `{"type": "error", "msg"}` | Anything worth saying. An `error` is followed by the driver exiting. |

Exit codes: 0 for a clean stop, 2 LeRobot is not installed, 3 the connection failed, 4 no calibration for that id, 5 the bus was lost.

### Base driver

Input: `{"cmd": "drive", "x", "y", "w"}` as above, `{"cmd": "stop"}`, `{"cmd": "reset_odom"}`, and `{"cmd": "ping"}`, which the bridge sends every second to keep an idle base alive.

Output: `ready` (with `max_lin`, `max_rot` and `watchdog`), `log`, `error`, and twenty times a second:

```json
{ "type": "odom", "pose": [x_m, y_m, heading_deg], "vel": [x, y, w], "cmd": [x, y, w], "wheels": [a, b, c], "stale": false }
```

`vel` is measured from the wheels and `cmd` is what the driver is ramping towards. `wheels` are the wheel angles in radians, for drawing them turn. `stale` means no drive command arrived within the watchdog.
