#!/usr/bin/env python
"""Read-only bus scan: ping every servo id and read its raw position.

Enables no torque and moves nothing, so it is safe to run any time. Use it
when the driver dies with "Failed to write \'Torque_Enable\' on id_=N ...
There is no status packet!" -- that message cannot tell you whether the servo
is genuinely unreachable (cable, power, wrong id) or whether one status packet
was simply dropped on a freshly-opened USB serial adapter. This says which:
if every id answers here, it was a dropped packet and the driver\'s connect
retry will ride over it.

    python drivers/scan.py /dev/cu.usbmodemXXXX
"""
import sys
from lerobot.motors import Motor, MotorNormMode
from lerobot.motors.feetech import FeetechMotorsBus

PORT = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: scan.py <serial port>")
NAMES = {1:"shoulder_pan",2:"shoulder_lift",3:"elbow_flex",4:"wrist_flex",5:"wrist_roll",6:"gripper"}

bus = FeetechMotorsBus(port=PORT, motors={n: Motor(i,"sts3215",MotorNormMode.DEGREES) for i,n in NAMES.items()})
bus.connect(handshake=False)
print(f"port open: {PORT}\n")

print("broadcast ping (id -> model number):")
found = bus.broadcast_ping()
print(" ", found if found else "no reply at all")

print("\nper-id ping:")
alive = []
for i, name in NAMES.items():
    model = bus.ping(i, num_retry=2)
    ok = model is not None
    if ok: alive.append(i)
    print(f"  id {i} {name:<15} {'OK  model ' + str(model) if ok else 'NO REPLY'}")

if alive:
    print("\npresent position (raw ticks) of the ones that answered:")
    for i in alive:
        try:
            raw = bus.read("Present_Position", NAMES[i], normalize=False)
            print(f"  id {i} {NAMES[i]:<15} {raw}")
        except Exception as e:
            print(f"  id {i} {NAMES[i]:<15} read failed: {e}")

bus.disconnect()
