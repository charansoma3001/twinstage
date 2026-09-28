# Configuration

Everything is set through environment variables, and none of them is required. Copy `.env.example` to `.env` at the repo root. Both `npm run server` and the web build read it, and a variable set in the shell wins over the file. `npm run sim` deliberately ignores `.env`, so a simulation can never pick up real ports.

## Bridge

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` | The bridge's HTTP and WebSocket port. It also serves the built pages. |

## SO-101 arms

| Variable | Default | |
|---|---|---|
| `ARM_PORT` | none | The follower's serial port. Unset means no follower. |
| `ARM_ID` | `follower` | The id the follower was calibrated under in LeRobot. |
| `LEADER_PORT` | none | The leader's serial port. Unset means no leader. |
| `LEADER_ID` | `leader` | The id the leader was calibrated under. |
| `LEADER_CAL_DIR` | `~/.cache/huggingface/lerobot/calibration/teleoperators/so_leader` | Where the leader's calibration file is. |
| `ARM_PYTHON` | `python3` | An interpreter with LeRobot and its Feetech extra installed. Give a full path; `~` is not expanded. |
| `ARM_DRY` | off | `1` runs both arm drivers without opening their ports. |
| `FOLLOWER_DRY_PRESENT`, `LEADER_DRY_PRESENT` | none | Dry run only: the pose a dry driver reports, as JSON in LeRobot degrees, for example `{"shoulder_pan": 10}`. |

## LeKiwi base

| Variable | Default | |
|---|---|---|
| `BASE_HOST` | none | The `ssh` destination of the base's Pi, for example `pi@lekiwi.local`. Unset means no base. |
| `BASE_PYTHON` | `~/lerobot/.venv/bin/python` | The interpreter on the Pi. |
| `BASE_SERIAL` | `/dev/ttyACM0` | The wheel bus's port on the Pi. |
| `BASE_DRY` | off | `1` runs the base driver without motors: on the Pi if `BASE_HOST` is set, otherwise on this machine. |
| `BASE_LOCAL_PYTHON` | `python3` | The interpreter for a local dry run. |

## Web build

These are read when the pages are built, so rebuild after changing them.

| Variable | Default | |
|---|---|---|
| `VITE_BRIDGE_URL` | `ws://localhost:8787` | The bridge, when the pages are served by the Vite dev server rather than the bridge. |
| `VITE_PRESENTER_NAME` | none | Shows a presenter's name on the stage, for live demos. |
| `VITE_PRESENTER_EVENT` | none | An event name, shown next to it. |
| `VITE_PRESENTER_QR` | none | An image URL for a QR code card, for example `/presenter-qr.png` in `web/public/`. The card shows only with a name and a QR code. |
| `VITE_PRESENTER_CAPTION` | none | A line under the name on the QR code card. |

## Driver limits

The bridge starts the drivers with their built-in limits. They are flags on the driver scripts, so to change one, change its default in `drivers/so101_arm.py` or `drivers/lekiwi_base.py`, and say why in the commit. [Safety](safety.md) explains what each does.

| Flag | Driver | Default |
|---|---|---|
| `--max-deg-per-s` | arm | 60 |
| `--gripper-pct-per-s` | arm | 200 |
| `--margin-deg` | arm | 3 |
| `--max-relative-target` | arm | 8 (0 disables it) |
| `--watchdog` | arm | 0.75 s |
| `--bus-error-s` | arm | 0.5 s |
| `--hz` | arm | 50 |
| `--max-lin`, `--max-rot` | base | 0.25 m/s, 60 °/s |
| `--lin-accel`, `--lin-decel` | base | 0.5, 1.5 m/s² |
| `--rot-accel`, `--rot-decel` | base | 180, 540 °/s² |
| `--watchdog` | base | 0.4 s |
| `--link-timeout` | base | 5 s |

## Stored in the browser

Camera roles, which hand drives which arm, the arm layout and the table calibration are saved per browser, in local storage. They move with the machine, not the repo, so set them again on a new laptop.
