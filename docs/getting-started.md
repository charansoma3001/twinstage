# Getting started

Go one step at a time, and do each dry run before the live one. Every step works without the steps after it.

1. [The simulation](#1-the-simulation): nothing to connect
2. [One follower arm](#2-one-follower-arm)
3. [Leader and follower](#3-leader-and-follower): teleop and hands
4. [The LeKiwi base](#4-the-lekiwi-base)

You need Node.js 22.9 or later and Python 3.10 or later throughout.

```bash
git clone https://github.com/charansoma3001/twinstage.git
cd twinstage
npm install
```

## 1. The simulation

```bash
npm run sim
```

This builds the pages and starts the bridge with both arm drivers and the base driver in dry run. The drivers are the real ones: they run their loop, slew limit and watchdog, but report a simulated pose instead of talking to motors.

- **The stage, <http://localhost:8787>.** Try Teleop, Hands and the task primitives, and the Base view. Arrow keys drive the base, A and D strafe, Space stops.
- **Settings, <http://localhost:8787/settings>.** The Sandbox step drives one twin from sliders. The other steps are for real hardware.

Hand tracking needs a camera. The browser asks for one the first time; the stage uses its **hand camera**, which you pick in **Settings → Cameras & hands**.

## 2. One follower arm

You need a working LeRobot install with the Feetech extra, and the arm calibrated with LeRobot. [Hardware](hardware.md#so-101-arms) covers both. Then:

```bash
cp .env.example .env
```

In `.env`, set:

```bash
ARM_PORT=/dev/tty.usbmodemXXXXXXXX     # the follower's serial port
ARM_ID=follower                        # the id you calibrated it under
ARM_PYTHON=/path/to/lerobot/.venv/bin/python
```

Dry run first. It checks the wiring without opening the port: the bridge starts the driver, and the pages see an arm to talk to. Nothing on the bus is touched:

```bash
npm run build
ARM_DRY=1 npm run server
```

Then run it live. On connecting, the driver loads your calibration, powers the arm and holds it where it already is; it never jumps to a pose. Now measure the joint map. The twin is zeroed at the URDF's pose and your arm is zeroed at the middle of whatever range you swept while calibrating, so the two never agree until you measure the difference:

```bash
npm run server
```

1. Open **Settings → Connect** and press **Link bridge**.
2. Open **Joint map**, choose **Follower**, and press **Mirror the real arm**. Torque goes off, so hold the arm.
3. Pose it by hand and drag each offset until the twin matches. [Joint map](joint-map.md) explains how to check it.
4. Press **Save joint map** and restart the bridge.

The **Sandbox** step now drives the real follower from the sliders. It moves at most 60 degrees a second per joint, and **Relax** (or Esc) cuts torque.

## 3. Leader and follower

Add the leader to `.env`:

```bash
LEADER_PORT=/dev/tty.usbmodemYYYYYYYY
LEADER_ID=leader
```

The leader was calibrated as a LeRobot teleoperator, so its calibration file lives under `teleoperators/so_leader`. That is the default; set `LEADER_CAL_DIR` if yours is elsewhere.

Dry run, then live. Then:

1. **Teleop** works straight away: on the stage press **Teleop**, and the follower copies the leader.
2. **Hands** needs three more things from Settings:
   - **Cameras & hands:** pick the hand camera. It should look straight down at the table, where both hands will be.
   - **Table calibration:** capture the four corners on the table and the four at hover height.
   - **Joint map:** measure the **Leader** too. Hands mode drives both arms and refuses to run a live arm without its saved map.
3. **Arm layout:** measure the distance between the two arms' bases and enter it. The keep-out between the arms is worked out from it.

On the stage, **Hands** now drives both arms. The card under the arms switches between both arms and the follower alone.

## 4. The LeKiwi base

The base is driven over `ssh` on its Raspberry Pi, which needs LeRobot installed at `~/lerobot/.venv` (LeRobot's own LeKiwi setup puts it there). Set up key-based `ssh` to the Pi first; the bridge will not prompt for a password.

```bash
BASE_HOST=pi@lekiwi.local
```

Dry run on the Pi first. That proves `ssh`, the network and the phone page, and moves nothing:

```bash
BASE_DRY=1 npm run server
```

Then run it live, and switch the stage to **Base**. The bridge prints a `phone drive page` address at start-up; open it on a phone on the same network to drive from there. [Hardware](hardware.md#lekiwi-base) covers the Pi's networking.

## Next

- [Modes](modes.md) explains what each mode does to each arm.
- [Safety](safety.md) lists every guard. Read it before a live demo.
- [Troubleshooting](troubleshooting.md) covers what to do when a driver will not connect.
