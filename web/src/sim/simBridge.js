import { createArms } from "../../../server/arms.js";
import { createModes } from "../../../server/modes.js";
import { createBase } from "../../../server/base.js";
import { createHub, isValidJointMap } from "../../../server/hub.js";
import { simArmSpawner, simBaseSpawner } from "./simDrivers.js";

/* =========================================================================
   The bridge, inside the page, for the Pages demo.

   The same modules as server/index.js (modes, arm supervision, drive
   ownership, message routing), with simulated drivers in place of the
   Python ones. Every page in the demo talks to this instead of a
   WebSocket, and /api calls are answered from it. Each tab runs its own.
   ========================================================================= */
const MAP_KEY = (arm) => `twinstage:demo:joint-map:${arm}`;
const loadMap = (arm) => {
  try { return JSON.parse(localStorage.getItem(MAP_KEY(arm)) || "null"); } catch { return null; }
};

let sim = null;

function build() {
  const clients = new Set();
  const broadcast = (obj) => {
    const payload = JSON.stringify(obj);
    for (const c of clients) c.send(payload);
  };
  let modes = null;
  const arms = createArms({
    config: {
      follower: { port: "sim", portVar: "ARM_PORT", id: "follower", map: "joint_map.json", calibrationDir: null, startRelaxed: false },
      leader: { port: "sim", portVar: "LEADER_PORT", id: "leader", map: "joint_map_leader.json", calibrationDir: "sim", startRelaxed: true }
    },
    python: "sim", script: "so101_arm.py", dry: true, broadcast,
    spawn: simArmSpawner({ loadMap, getMode: () => modes?.current() }),
    onPresent: (name, msg) => modes.onPresent(name, msg),
    onDriverExit: (name) => modes.onDriverExit(name)
  });
  modes = createModes({ arms, broadcast });
  const base = createBase({
    config: { host: null, dry: true, localPython: "sim", script: "lekiwi_base.py", serial: "sim", tag: "sim" },
    broadcast, spawn: simBaseSpawner()
  });
  const hub = createHub({ arms, modes, base, broadcast });
  arms.startAll();
  base.start();
  return { hub, clients };
}

/* Same interface as createBridgeLink in ../bridge.js. */
export function createSimLink() {
  sim ??= build();
  let open = false;
  const handlers = { message: new Set(), open: new Set(), close: new Set() };
  const emit = (kind, arg) => { for (const fn of handlers[kind]) fn(arg); };
  const on = (kind) => (fn) => {
    handlers[kind].add(fn);
    return () => handlers[kind].delete(fn);
  };
  // What the bridge sees: something it can send a JSON string to.
  const client = {
    send(payload) {
      if (open) queueMicrotask(() => emit("message", JSON.parse(payload)));
    }
  };

  return {
    connect() {
      if (open) return;
      open = true;
      sim.clients.add(client);
      queueMicrotask(() => {
        emit("open");
        client.send(JSON.stringify(sim.hub.hello()));
      });
    },
    disconnect() {
      if (!open) return;
      open = false;
      sim.clients.delete(client);
      sim.hub.clientLeft(client);
      queueMicrotask(() => emit("close"));
    },
    send(obj) {
      if (!open) return false;
      queueMicrotask(() => sim.hub.handle(client, obj));
      return true;
    },
    isConnected: () => open,
    isLinking: () => false,
    onMessage: on("message"),
    onOpen: on("open"),
    onClose: on("close")
  };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* The bridge's /api, answered from the simulation. Joint maps are kept in
   this browser's storage. */
export async function simFetch(url, init = {}) {
  sim ??= build();
  const u = new URL(url, location.href);
  const route = u.pathname.replace(/.*\/api\//, "");
  if (route === "health") return json(sim.hub.health());
  if (route === "state") return json(sim.hub.stats());
  if (route === "joint-map") {
    const arm = u.searchParams.get("arm") || "follower";
    if (!["follower", "leader"].includes(arm)) return json({ error: "unknown arm" }, 400);
    if ((init.method || "GET").toUpperCase() === "POST") {
      const body = JSON.parse(init.body || "null");
      if (!isValidJointMap(body)) return json({ error: "each body joint needs sign +/-1 and a finite offset_deg" }, 400);
      try { localStorage.setItem(MAP_KEY(arm), JSON.stringify(body)); } catch { /* storage off: held for this page only */ }
      return json({ ok: true, path: "this browser's storage" });
    }
    return json(loadMap(arm));
  }
  return json({ error: "not found" }, 404);
}
