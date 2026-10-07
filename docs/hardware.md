# Hardware

Twinstage drives the hardware through LeRobot, so anything LeRobot can calibrate and read, the drivers can use. This page covers what is specific to Twinstage.

## SO-101 arms

The follower is the arm that does the work. The leader is the lighter, hand-held arm; in teleop you move it and the follower copies it, and in hands mode it is powered and driven like the follower.

### Install LeRobot

The drivers need LeRobot with the Feetech servo SDK:

```bash
pip install 'lerobot[feetech]'
```

Or, from a clone of LeRobot:

```bash
uv sync --extra feetech
```

Point `ARM_PYTHON` at that environment's interpreter, for example `ARM_PYTHON=/path/to/lerobot/.venv/bin/python`, or activate it before starting the bridge.

### Find each arm's port

```bash
lerobot-find-port
```

Unplug and replug when it asks. On macOS ports look like `/dev/tty.usbmodem5A...`, on Linux like `/dev/ttyACM0`. The follower goes in `ARM_PORT`, the leader in `LEADER_PORT`.

### Calibrate with LeRobot

Twinstage uses LeRobot's own calibration and never writes it. Calibrate each arm once:

```bash
lerobot-calibrate --robot.type=so101_follower --robot.port=$ARM_PORT --robot.id=follower
lerobot-calibrate --teleop.type=so101_leader --teleop.port=$LEADER_PORT --teleop.id=leader
```

The ids become `ARM_ID` and `LEADER_ID`. The files land under `~/.cache/huggingface/lerobot/calibration/`:

- The follower's is under `robots/so_follower/`. The driver finds it by `ARM_ID`.
- The leader's is under `teleoperators/so_leader/`. `LEADER_CAL_DIR` defaults to that folder.

During calibration you sweep each joint through its range. The driver keeps every goal 3 degrees inside the range you swept, so sweep the full range you want to use.

### Check the bus without moving anything

```bash
python drivers/scan.py /dev/tty.usbmodemXXXXXXXX
```

It pings servo ids 1 to 6 and reads their positions, without enabling torque. Use it when a driver fails to connect; [troubleshooting](troubleshooting.md#a-driver-will-not-connect) explains what the result means.

### Measure the joint map

The twin needs to know how each real joint lines up with the model's. Measure it once per arm, in **Settings → Joint map**; [Joint map](joint-map.md) explains how. The maps are saved to `drivers/joint_map.json` (follower) and `drivers/joint_map_leader.json` (leader). They belong to your arms, so git ignores them.

## Cameras

- **The hand camera** looks straight down at the table from above, with both hands in view. Any USB webcam works; it is read at 640×480, which is also the size the table is calibrated at. Hand tracking runs in the browser, on the GPU.
- **The follower camera** is optional. It is shown on the stage so an audience sees the real arm next to its twin.

Choose which camera is which in **Settings → Cameras & hands**. Each camera can also be turned upside down or mirrored left to right there, for however it is mounted. The choice is saved in the browser, so choose again on a new machine.

## LeKiwi base

The base is driven by `drivers/lekiwi_base.py` on the base's own Raspberry Pi. The bridge sends the script over `ssh` on every start, so nothing needs installing or keeping in sync on the Pi except LeRobot itself.

- **LeRobot on the Pi.** It is expected at `~/lerobot/.venv`, where LeRobot's LeKiwi setup puts it. Set `BASE_PYTHON` if it is elsewhere.
- **Serial port.** The wheel bus is `/dev/ttyACM0` unless `BASE_SERIAL` says otherwise.
- **Only the wheels.** The driver opens a bus holding only servo ids 7, 8 and 9 (the three wheels). The arm on the same bus, ids 1 to 6, is never addressed, so nothing the base driver does can move the arm or change its torque.
- **ssh.** The bridge runs `ssh` in batch mode and never prompts, so set up key-based login to `BASE_HOST` first, and check that `ssh $BASE_HOST` works without a password.

### Networking

The laptop, the Pi and any phone that drives the base must reach each other.

- **Same Wi-Fi.** This is the easiest setup, but venue and campus Wi-Fi often block traffic between devices. A phone hotspot that the laptop, the Pi and the phone all join is the reliable fallback.
- **Ethernet cable, laptop to Pi.** The Pi's NetworkManager waits for DHCP, and a direct cable has no DHCP server, so the Pi gets no IPv4 address. Any `169.254.x.x` address you see on the laptop is the laptop's own. Fix it one of two ways:
  - On macOS, turn on **Internet Sharing** to the Ethernet adapter. The Mac then hands the Pi an address.
  - On the Pi, allow link-local addresses on the wired connection: `nmcli con mod <connection> ipv4.method link-local`, then bring the connection up again.
- **macOS Local Network permission.** macOS asks once whether your terminal (or `node`) may talk to devices on the local network. Until it is allowed, `ssh` to the Pi and the phone drive page fail with no clear error. It is under **System Settings → Privacy & Security → Local Network**.

### The phone drive page

The bridge prints `phone drive page: http://<address>:8787/drive` for each network it is on. Open it on the phone, hold the pad to drive, and let go to stop. One device drives at a time; the other is told someone else is driving.
