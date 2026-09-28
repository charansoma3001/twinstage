import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import WebSocket from "ws";

/* Boots the real bridge with both arm drivers and the base in dry run (the
   Python drivers, standard library only) and speaks the protocol to it. */
const ENTRY = fileURLToPath(new URL("../index.js", import.meta.url));
const BUILT = existsSync(fileURLToPath(new URL("../../dist/index.html", import.meta.url)));

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

let bridge, port, log = "";

async function until(check, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await check().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out; bridge log:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  const next = (pred) => until(async () => inbox.find(pred));
  return new Promise((resolve) => ws.on("open", () => resolve({ ws, inbox, next, send: (o) => ws.send(JSON.stringify(o)) })));
}

beforeAll(async () => {
  port = await freePort();
  bridge = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env, PORT: String(port),
      ARM_DRY: "1", ARM_PORT: "/dev/null", LEADER_PORT: "/dev/null",
      BASE_DRY: "1", BASE_HOST: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  bridge.stdout.on("data", (d) => { log += d; });
  bridge.stderr.on("data", (d) => { log += d; });
  await until(async () => {
    const h = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    return h.arms.follower.ready && h.arms.leader.ready && h.base.ready && h;
  });
}, 15000);

afterAll(() => bridge?.kill("SIGINT"));

describe("bridge, end to end in dry run", () => {
  it("reports both arms and the base in the hello", async () => {
    const c = await client();
    const hello = await c.next((m) => m.type === "hello");
    expect(hello.arms.follower).toMatchObject({ ready: true, dryRun: true });
    expect(hello.arms.leader).toMatchObject({ ready: true, dryRun: true });
    expect(hello.base).toMatchObject({ ready: true, dryRun: true });
    expect(hello.mode.mode).toBe("idle");
    c.ws.close();
  });

  it("drops stage joints in idle and forwards them in hands", async () => {
    const c = await client();
    const joints = [0.1, -0.5, 0.6, 0.3, 0, 0.4];
    c.send({ joints, arm: "follower", src: "stage" });
    await new Promise((r) => setTimeout(r, 200));
    const stats = async () => (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    expect((await stats()).commandCount).toBe(0);

    c.send({ cmd: "mode", mode: "hands" });
    await c.next((m) => m.type === "mode" && m.mode === "hands");
    c.send({ joints, arm: "follower", src: "stage" });
    await until(async () => (await stats()).commandCount === 1);
    // The settings page is not a hands source.
    c.send({ joints, arm: "follower", src: "studio" });
    await new Promise((r) => setTimeout(r, 200));
    expect((await stats()).commandCount).toBe(1);

    c.send({ cmd: "freeze" });
    await c.next((m) => m.type === "mode" && m.mode === "idle" && m.note === "stop pressed");
    c.ws.close();
  });

  it("refuses bad joint maps and unknown arms", async () => {
    const url = `http://127.0.0.1:${port}/api/joint-map?arm=nobody`;
    expect((await fetch(url)).status).toBe(400);
    const bad = await fetch(`http://127.0.0.1:${port}/api/joint-map?arm=follower`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shoulder_pan: { sign: 3 } })
    });
    expect(bad.status).toBe(400);
  });

  it.skipIf(!BUILT)("serves the built pages", async () => {
    for (const page of ["/", "/settings", "/drive"]) {
      expect((await fetch(`http://127.0.0.1:${port}${page}`)).status).toBe(200);
    }
  });

  it("drives the dry base and reports odometry", async () => {
    const c = await client();
    c.send({ cmd: "drive", x: 0.1, y: 0, w: 0 });
    const odom = await c.next((m) => m.type === "base" && m.kind === "odom" && m.cmd?.[0] > 0);
    expect(odom.cmd[0]).toBeGreaterThan(0);
    c.send({ cmd: "base_stop" });
    c.ws.close();
  });
});
