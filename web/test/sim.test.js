// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createSimLink, simFetch } from "../src/sim/simBridge.js";

/* The Pages demo runs the bridge's own modules against simulated drivers.
   These check it behaves like a dry-run bridge: the same hello, the same
   mode rules, and the driver's slew limit. Real time, about three seconds. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

function client() {
  const link = createSimLink();
  const inbox = [];
  link.onMessage((m) => inbox.push(m));
  link.connect();
  return { link, inbox };
}

describe("the in-browser bridge", () => {
  it("says hello with both arms and the base ready in dry run", async () => {
    const { inbox } = client();
    await wait(50);
    const hello = inbox.find((m) => m.type === "hello");
    expect(hello.arms.follower).toMatchObject({ ready: true, dryRun: true });
    expect(hello.arms.leader).toMatchObject({ ready: true, dryRun: true, relaxed: true });
    expect(hello.base).toMatchObject({ ready: true, dryRun: true });
  });

  it("tells every open page when the mode changes", async () => {
    const a = client(), b = client();
    await wait(20);
    a.link.send({ cmd: "mode", mode: "hands" });
    await wait(20);
    expect(a.inbox.some((m) => m.type === "mode" && m.mode === "hands")).toBe(true);
    expect(b.inbox.some((m) => m.type === "mode" && m.mode === "hands")).toBe(true);
    a.link.send({ cmd: "freeze" });
    await wait(20);
  });

  it("slews the follower towards a goal no faster than 60 degrees a second", async () => {
    const { link, inbox } = client();
    await wait(20);
    link.send({ cmd: "mode", mode: "hands" });
    link.send({ cmd: "telemetry", arm: "follower", on: true, hz: 50 });
    const t0 = performance.now();
    const stream = setInterval(() => link.send({ joints: [Math.PI / 2, 0, 0, 0, 0, 0], arm: "follower", src: "stage" }), 20);
    await wait(800);
    clearInterval(stream);
    const pans = inbox.filter((m) => m.type === "present" && m.arm === "follower").map((m) => m.pos.shoulder_pan);
    const elapsed = (performance.now() - t0) / 1000;
    expect(Math.max(...pans)).toBeGreaterThan(20);
    expect(Math.max(...pans)).toBeLessThanOrEqual(60 * elapsed + 2);
    link.send({ cmd: "freeze" });
  });

  it("moves the follower in teleop, from the simulated leader", async () => {
    const { link, inbox } = client();
    await wait(20);
    link.send({ cmd: "mode", mode: "teleop" });
    await wait(1500);
    const pans = inbox.filter((m) => m.type === "status" && m.arm === "follower").map((m) => m.command.shoulder_pan);
    expect(Math.max(...pans) - Math.min(...pans)).toBeGreaterThan(1);
    link.send({ cmd: "freeze" });
  });

  it("answers /api from the simulation, and validates joint maps", async () => {
    expect((await (await simFetch("api/health")).json()).ok).toBe(true);
    expect((await simFetch("api/joint-map?arm=nobody")).status).toBe(400);
    const bad = await simFetch("api/joint-map?arm=follower", { method: "POST", body: JSON.stringify({ shoulder_pan: { sign: 2 } }) });
    expect(bad.status).toBe(400);
  });
});
