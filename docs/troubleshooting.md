# Troubleshooting

## The bridge will not start

**`port 8787 is already in use`.** Another bridge is almost always still running. Find it with:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

Stop that process, or start this one on another port with `PORT=8788 npm run server`. If the other one is driving real arms, stop it from its own terminal rather than killing it, so its arms relax where they are.

**The pages are blank or 404.** The bridge serves the build in `dist/`. Run `npm run build` first, or use `npm start` in development, which runs the Vite dev server alongside the bridge.

## A driver will not connect

**`lerobot import failed`.** `ARM_PYTHON` is not an interpreter with LeRobot installed. Give the full path to your LeRobot environment's `python`; see [hardware](hardware.md#install-lerobot).

**`no calibration for id 'follower'`.** The driver looked for a LeRobot calibration under `ARM_ID` and found none. Set `ARM_ID` (or `LEADER_ID`) to the id you calibrated with, or calibrate under this one. The leader's calibration is looked for in `LEADER_CAL_DIR`.

**`Failed to write 'Torque_Enable' on id_=3 ... There is no status packet!`** This does not tell you whether a servo is unreachable or one reply was dropped, which happens on a freshly opened USB serial adapter. The driver retries the connection three times, 0.6 s apart. If it still fails, scan the bus without moving anything:

```bash
python drivers/scan.py /dev/tty.usbmodemXXXXXXXX
```

If every id from 1 to 6 answers, it was a dropped packet; start the bridge again. If one id stays silent, check that servo's cable, its power, and its id.

**Only one program can open a serial port.** If connecting fails right after you ran LeRobot's own scripts, another bridge, or `jog.py`, check that none of them still has the port.

## An arm drops off the bus

**`There is no status packet!` mid-run.** One missed reply from one servo, not a loose cable. LeRobot reads every servo back before each write, so each arm does about 50 reads a second, and on a busy bus one occasionally goes missing. The driver sends the same goal again on the next tick. Only half a second of back-to-back failures counts as the bus being gone.

**The stage says "Reconnecting".** The driver exited, and the bridge restarts it after 1 s, then 2, 3, 4 and 5. A restart drops the mode to idle; choose it again once the arm reads "Holding".

**The stage says "Lost: check cable".** It died five times in a minute, and the bridge stopped trying. Check the cable and the arm's power supply, then restart the bridge.

## Hands mode

**It is refused with "no joint map for leader".** Hands mode will not drive a live arm without a measured map. Measure it in **Settings → Joint map**; see [joint map](joint-map.md).

**The arms follow the wrong hands.** A camera looking down can report left and right the wrong way round. Flip **Settings → Cameras & hands → Hand labels**. Each skeleton on the stage is drawn in its arm's colour, so check that before driving.

**The arm moves left when my hand moves right.** Change **Swap left/right** in **Settings → Table calibration**.

**Height is wrong, or jumps.** Recapture the table and hover corners. Calibration belongs to one camera in one position; moving the camera invalidates it.

**The camera does not start.** The browser needs permission, on each site and port. Allow it from the address bar. On macOS, the browser itself also needs camera access, under **System Settings → Privacy & Security → Camera**.

**Tracking is slow.** See [performance](performance.md#hand-tracking). The stage draws the twin at lower resolution while tracking for this reason. Close other tabs that use the GPU.

## The base

**`ssh` fails, or asks for a password.** The bridge runs `ssh` in batch mode and never prompts. Check that `ssh $BASE_HOST` works without a password first.

**The Pi is unreachable over an Ethernet cable.** It has no IPv4 address; see [hardware](hardware.md#networking).

**The phone drive page will not load.** The phone must be on the same network as the laptop, and venue Wi-Fi often blocks traffic between devices; a phone hotspot fixes it. On macOS, allow the terminal (or `node`) under **Privacy & Security → Local Network**, and accept incoming connections to `node` if asked.

**"Someone else is driving".** Another page drove within the last second. Only one drives at a time; STOP works from any of them.

## The settings page

**The Joint map step says "Needs the bridge".** The page is served by the Vite dev server with no bridge running, or the bridge is down. Start it with `npm run server`.

**Linking settings stopped the stage.** That is intended: linking takes the arms, in manual mode. Choose a mode on the stage to take them back.
