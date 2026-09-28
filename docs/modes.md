# Modes

The bridge holds one mode at a time and decides from it who may command which arm. The stage shows the mode and asks for changes; it never assumes one. Two pages open at once always agree.

| Mode | Leader | Follower | Who commands the arms |
|---|---|---|---|
| Idle | holds, or stays limp | holds | nobody |
| **Teleop** | limp, read at 50 Hz | copies the leader | you, moving the leader by hand |
| **Hands** | powered | powered | the stage: each hand drives one arm |
| **Primitives** | powered | powered | the stage: a scripted task on one arm or both |
| Manual | as the settings page says | as the settings page says | the settings page, while it is linked |

Joint commands from a page that is not in charge are dropped by the bridge, not by the page, so a stale tab cannot move an arm.

## Teleop

Move the leader and the follower copies it. The leader's torque is off, and its position is read every 20 ms and sent to the follower, which moves there at most 60 degrees a second per joint.

Switching to teleop from a mode where the leader is powered would drop it under gravity. So the bridge first holds both arms, shows **Hold the leader: its motors switch off** with a three-second countdown, and only then relaxes it. Pressing STOP during the countdown cancels it.

Teleop needs both arms' drivers running. It is refused otherwise.

## Hands

One overhead camera tracks both hands, and each hand drives one arm:

- **Where the palm is** on the calibrated table sets where the arm reaches.
- **How high the palm is** sets the tool height, between the table and the hover height you calibrated.
- **Thumb spread** (the angle between thumb and index finger) opens and closes the gripper.
- The approach is straight down, which is what picks a block off a table. Where straight down is out of reach, the arm tilts as little as it has to.

Each hand works the whole calibrated table, mapped over its own arm's reach. By default your left hand drives the leader; **Swap** on the stage, or **Settings → Cameras & hands**, changes that. Each skeleton on the stage is drawn in its arm's colour, so a swap shows before anything moves.

Hands are told apart by MediaPipe's left and right labels. A camera looking down can report them the wrong way round; **Settings → Cameras & hands → Hand labels** flips them. If both hands come back with the same label, their positions on the table decide.

The **Follower | Both** switch on the Hands card chooses whether one hand drives the follower alone, with the leader holding still, or both hands drive both arms. Switching is instant.

A hand that leaves the camera's view stops that arm's stream, and the driver's watchdog holds the arm where it is.

Hands mode refuses to start unless both drivers are running, and refuses a live arm without a saved [joint map](joint-map.md). Driving an arm whose joints are misread would put it somewhere other than where the twin shows.

## Task primitives

Scripted paths for the gripper, turned into joints by the same inverse kinematics as hands mode:

- **Rest:** fold the arm and nearly close the jaws.
- **Pick & place:** pick a block at one station, carry it to the other, and back. The stations are marked on the stage's table, so you can tape them on the real one.
- **Precision pinch:** hold still while the jaws open and close and the wrist rolls.
- **Waveform scan:** sweep across the workspace while changing height and pitch.

Run a primitive on the leader, the follower, or both. With both, the arm on the operator's left runs the mirror image, so the pair moves symmetrically.

Primitives have the same requirements as hands mode, and go through the same keep-out.

## Manual

Linking the settings page puts the bridge in manual mode: the settings page drives the arms (its Sandbox sliders, demo loop and joint-map tool), and whatever the stage was doing stops. Pick a mode on the stage to take the arms back.

## The base

The stage's **Base** view drives the LeKiwi base from the keyboard: arrow keys drive and turn, A and D strafe, Space or Esc stops. The phone drive page does the same from a phone. Input is hold-to-move: letting go, switching tabs or locking the phone stops the base.

The twin's position comes from wheel odometry, so it drifts: omniwheels slip. The floor is an endless grid that follows the base, so the drift has nothing to be wrong against. **Reset** clears the odometry and the trail. The arm on the base is drawn at its zero pose; its live joints are not shown.

## STOP and Relax

They do different things, deliberately.

| | Where | What it does |
|---|---|---|
| **STOP** | stage header, or Esc on the stage | Holds both arms where they are, stops the base, and drops to idle. Nothing falls. |
| **Relax** | settings header, or Esc on the settings page | Cuts torque to the arms. They go limp and fall under gravity, so hold them first. Press again to power them and hold where they are. |

Use STOP when something looks wrong. Use Relax when you want to move an arm by hand.
