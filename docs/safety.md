# Safety

Twinstage moves real motors. The guards below are layered so that no single failure (a dropped network link, a crashed page, a misread hand) leaves an arm moving. They are not a substitute for watching the hardware. Keep people's hands and faces clear of the arms' reach while they are powered, and keep a hand near STOP.

The software is provided as is, without warranty; see the [license](../LICENSE).

## Arms

| Guard | Where | Default | What it does |
|---|---|---|---|
| Slew limit | driver, `--max-deg-per-s` | 60 °/s per joint | Every joint ramps towards its goal. The first goal after connecting is approached from where the arm really is, never snapped to. |
| Gripper slew | driver, `--gripper-pct-per-s` | 200 %/s | The same for the jaw. |
| Travel clamp | driver, `--margin-deg` | 3° inside calibration | Goals stay inside the range each joint swept during LeRobot calibration. |
| Per-step clamp | LeRobot, `--max-relative-target` | 8 units | LeRobot's own clamp against the arm's measured position, each step. |
| Watchdog | driver, `--watchdog` | 0.75 s | No command for that long and the arm holds its pose, rather than chasing a stale goal. |
| Keep-out | stage | from the arm layout | No part of either arm comes within half the gap of the midline between them. See below. |
| Joint map required | bridge | on | Hands and primitives refuse a live arm without a measured joint map. |
| Mode gate | bridge | on | Only the page in charge of the current mode can command an arm. |
| Teleop countdown | bridge | 3 s | Before the leader goes limp, both arms hold and the stage counts down. |
| Bus errors | driver, `--bus-error-s` | 0.5 s | One dropped packet is retried. Half a second of them and the driver exits instead of guessing. |
| Restart limit | bridge | 5 a minute | A driver that keeps dying is left stopped, and the stage says to check the cable. |
| STOP | stage, Esc | | Holds both arms where they are and drops to idle. |
| Relax | settings, Esc | | Cuts torque to every arm. They fall under gravity. |
| Exit | driver | | The drivers die with the bridge. LeRobot's `disable_torque_on_disconnect` relaxes the arm at its last commanded pose. |

### The keep-out

Two arms side by side can reach into each other's space. The keep-out works from **Settings → Arm layout**: the distance between the bases, and the closest the arms may come. Each arm may reach up to half the spacing less half the gap towards the other.

Before any target is sent, the stage solves the pose and measures the whole moving arm against that limit, open jaws included, using support points taken from the URDF's meshes. A target that would cross is moved away from the other arm until the arm fits. A target that cannot be cleared at all is not sent, so the driver holds the last pose that fitted.

Teleop needs no keep-out, and has none. The follower takes the leader's calibrated joint readings, so the two arms are the same shape, to within the difference between their two calibrations, moved sideways by the base spacing. They stay that far apart whatever you do with the leader.

This is tested against the full meshes for four rig layouts, every approach pitch, wrist roll and jaw opening, and all the primitives (`web/test/keepout.test.js`). Measure the spacing on the real table; the keep-out is only as good as that number.

## Base

| Guard | Where | Default | What it does |
|---|---|---|---|
| Speed cap | driver, `--max-lin`, `--max-rot` | 0.25 m/s, 60 °/s | Full stick is this. LeRobot's wheel speed cap still applies. |
| Ramps | driver, `--lin-accel`, `--lin-decel` | 0.5, 1.5 m/s² | Starts are gentle, and stopping is three times quicker than starting. |
| Hold to move | pages | | Every input sends zero when released. Leaving the tab or locking the phone stops. |
| One driver at a time | bridge | 1 s | Whoever last drove owns the base until idle for a second. Anyone can stop it. |
| Disconnect | bridge | | The driving page's connection closing stops the base at once. |
| Watchdog | driver on the Pi, `--watchdog` | 0.4 s | No drive command for that long and the goal is zero, whatever the network did. |
| Link timeout | driver on the Pi, `--link-timeout` | 5 s | No word from the bridge at all and the driver exits, freeing the port. |
| Exit | driver | | Wheels zeroed, then their torque off so the base can be pushed. |

The base driver never addresses the arm mounted on the same bus.

## What is not guarded

Know these before a demo:

- **The path between two checked poses.** The keep-out checks every target the stage sends. The driver then moves each joint towards its goal separately, and the path in between is not checked. At 50 targets a second the steps are small, but a large jump (a hand reappearing far from where it left) is not.
- **Anything not in the URDF.** Cables, a block in the gripper, a camera mount: none of it is in the model, so none of it is kept out.
- **Everything else in the room.** Nothing detects people, the table's edge, or objects. The workspace keeps the tool's targets at or above the table surface and within reach, and that is all.
- **The arm hitting itself.** Joint limits keep it inside its calibrated range, but there is no self-collision check.
- **A hard kill.** The base's servos hold their last speed until told otherwise. A driver killed outright, or a Pi that loses power, skips the exit path. Every other way of stopping has been exercised.
- **A wrong joint map.** A map that is subtly wrong puts the real arm somewhere other than where the twin shows, and every guard above works from the twin's numbers. Check the map at three poses; see [joint map](joint-map.md).

## Before a demo

1. Run with `ARM_DRY=1` (and `BASE_DRY=1`) first, every time you change the setup.
2. Check each arm's joint map by mirroring it and posing it.
3. Measure the arm spacing on the table and enter it in **Arm layout**.
4. Start in teleop, where the follower only goes where you move the leader, before hands or primitives.
5. Know where STOP is: the red button, or Esc on the stage.
