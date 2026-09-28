# Performance

Measured on the setup we demo with: an M1 MacBook, Chrome, two SO-101 arms on their own USB buses. Where the numbers came from is given, so a change can be checked against them.

## Where the time goes

From a hand moving to the arm moving, in hands mode:

| Step | Time |
|---|---|
| Camera frame and hand model | about 53 ms per frame, 17 to 18 frames a second |
| Retargeting, inverse kinematics and keep-out | under 0.2 ms per arm |
| Browser to bridge to driver | one 20 ms tick at most; goals are sent at 50 Hz |
| Driver to arm, one write | about 1 ms |
| **Slew limit** | **a 30° move takes 0.5 s at 60 °/s** |

The slew limit is by far the largest delay, and deliberately so: it is what makes every move a ramp. Raise `--max-deg-per-s` in `drivers/so101_arm.py` to trade that away; see [safety](safety.md) first.

## The bus

Reading all six servos' positions takes 1.00 ms (median; 1.18 ms at the 95th percentile) on either arm, and 1.2 ms with both buses running at 50 Hz. There were no drops in 2,000 idle reads.

- Teleop reads the leader every 20 ms tick, at 50 Hz.
- LeRobot's `max_relative_target` check reads the arm back before each write. That costs about 1 ms of each 20 ms tick, so it stays on: turning it off would buy almost no latency and remove one of two overlapping guards.
- Each driver logs its loop and bus timing every five seconds (`loop p50/p95 ms, bus p50/p95 ms, overruns, bus errors`) in the bridge's terminal.

Against a simulated bus losing 20% of packets, a driver ran for 4 s without exiting (31 recoveries). A bus that stopped answering was given up on 0.56 s later.

## Hand tracking

Hand tracking is MediaPipe's Hand Landmarker, on the GPU, on the page's own thread. The model and runtime are bundled in `web/public/mediapipe/`, so nothing is fetched from a CDN and it works offline.

| Setup | Per frame | Tracking | Page |
|---|---|---|---|
| Legacy `@mediapipe/hands`, page thread | 70 ms | 13 fps | 15 fps |
| Tasks in a worker, GPU | 295 ms | 3 fps | 60 fps |
| Tasks in a worker, CPU | 110 ms | 9 fps | 60 fps |
| Tasks on the page, twin at 1.8× resolution | 100 ms | 10 fps | 10 fps |
| **Tasks on the page, twin at 1×** | **53 ms** | **17 to 18 fps** | **20 fps** |

A worker frees the page, but Chrome gives it a slow GPU path, and the arms need the tracking rate more than the page needs 60 frames a second. The twin shares the GPU, so the stage draws it at 1× while the hand camera is active, and at full sharpness in teleop and primitives.

Capture size made no difference to speed (640×480 and 1280×720 both took 46 to 62 ms). 640×480 is used because it is what the table is calibrated at.

## The keep-out

Checking an arm's whole body against the keep-out costs 0.03 ms when the target already fits, and 0.12 ms when it has to be moved. For two arms at 60 frames a second, that is under 1.5% of one core.
