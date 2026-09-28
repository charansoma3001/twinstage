# Joint map

The twin's joints are the URDF's angles. A real arm reports LeRobot's calibrated degrees, whose zero is the middle of the range you swept while calibrating, which has nothing to do with the URDF's zero. So each joint needs two numbers:

```
arm_deg = sign × model_deg + offset_deg
```

- **The offset**, because the two zeros are unrelated.
- **The sign**, because whether a servo's positive direction matches the model's depends on how it was mounted, which no software can see.

The gripper has its own entry, `closed_pct` and `open_pct`: the arm's reading with the jaws closed and fully open. Swapping them reverses the jaw.

Each arm needs its own map: the leader's gearing and calibration differ from the follower's. Hands mode and primitives refuse to drive a live arm without one.

## Measuring it

Measure it with the twin, by eye. The twin is the measuring instrument.

1. Start the bridge with the arm live, and open **Settings**.
2. **Connect → Link bridge.**
3. **Joint map →** choose the arm, and press **Mirror the real arm**. Torque goes off, so hold the arm as it goes limp. The twin now follows what the arm reports, through the map you are editing.
4. Pose the arm by hand. Drag each joint's offset until the twin matches the arm in front of you.
5. If a joint moves the wrong way, flip its sign with its **+** button, then match it again.
6. Check three poses before trusting it: folded, forearm level, and arm upright. An offset that fits one pose can still be wrong.
7. **Save joint map**, then restart the bridge so the driver loads it.

**The arm is at zero** sets every offset at once from the present reading. It is only useful if you can hold the arm exactly in the URDF's zero pose: the upper arm raised to about 76 degrees, the forearm and wrist level and pointing forward, and the wrist unrolled. The mirrored twin shows that pose when every reading equals its offset.

## Why by eye, and not a fit

It is tempting to fit sign and offset from a few matched poses. Doing that twice, once from spirit-level readings and once by optimising for straightness with a 1.6 mm residual, gave maps that were both confidently about 15 degrees wrong. A tight fit to a misjudged pose looks exactly like a good answer.

Comparing the picture to the arm directly, with no algebra in between, does not have that failure. Two things that do carry over:

- On the arm we measured this way, every sign came out +1.
- An offset can never make up for a flipped sign. A wrong sign shows as a folded, impossible-looking arm, not as a small error.

## The command-line fallback

`drivers/jog.py` measures the map without the twin. The arm goes limp, you match it by hand to the settings page's Sandbox pose at several poses, and it fits sign and offset per joint:

```bash
npm run jog -- --port /dev/tty.usbmodemXXXXXXXX --id follower
```

It needs the bridge running in dry run (so `jog.py` can open the serial port itself) with the settings page linked, since it reads the model's pose from the bridge.

It reports, per joint, how far the joint travelled across your poses, the worst mismatch after fitting, and the slope a free fit wanted. A joint that barely moved cannot have its sign measured, and the tool says so. Treat its answer as a starting point for the sliders, not as the answer.

## The files

| Arm | File |
|---|---|
| Follower | `drivers/joint_map.json` |
| Leader | `drivers/joint_map_leader.json` |

`drivers/joint_map.example.json` shows the format; it is the identity map, which the drivers use when no file exists. The real files belong to your arms, so git ignores them.
