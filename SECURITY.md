# Security

## Reporting a vulnerability

Email charan.soma311@gmail.com with what you found and how to reproduce it. Please do not open a public issue for it.

## What the bridge trusts

The bridge is built for a lab or a demo on a network you control. It has **no authentication**: anyone who can reach its port can drive the arms and the base, and save joint maps. By default it listens on every interface, so that phones can reach the drive page.

- On a shared or public network, run it behind a firewall, or on a network only your devices are on, such as a phone hotspot.
- Never expose its port to the internet.

## Physical safety

A bug that makes hardware move unexpectedly is a safety issue, even if nothing is exploited. Report it the same way, and read [safety](docs/safety.md) for what is and is not guarded.
