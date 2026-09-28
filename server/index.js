/* =========================================================================
   Twinstage bridge

   One process, one port: serves the built pages, a WebSocket for both of
   them, and owns every driver child (arms and base). The protocol is in
   docs/protocol.md; the pieces are:

     config.js  environment        arms.js   SO-101 arm drivers
     modes.js   who may command    base.js   LeKiwi base driver
     hub.js     client messages    driver.js newline-JSON child processes
     http.js    pages and /api
   ========================================================================= */
import http from "node:http";
import { WebSocketServer } from "ws";
import { PORT, DIST, ARM_CONFIG, ARM_DRY, ARM_PYTHON, ARM_SCRIPT, BASE } from "./config.js";
import { createArms } from "./arms.js";
import { createModes } from "./modes.js";
import { createBase } from "./base.js";
import { createApp, phoneUrls } from "./http.js";
import { createHub } from "./hub.js";
import { spawnDriver } from "./driver.js";
import { readFile } from "node:fs/promises";

let wss = null;
function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss?.clients ?? []) {
    if (client.readyState === 1) client.send(payload);
  }
}

let modes = null;
const arms = createArms({
  config: ARM_CONFIG, python: ARM_PYTHON, script: ARM_SCRIPT, dry: ARM_DRY, broadcast, spawn: spawnDriver,
  onPresent: (name, msg) => modes.onPresent(name, msg),
  onDriverExit: (name) => modes.onDriverExit(name)
});
modes = createModes({ arms, broadcast });
const base = createBase({
  config: BASE, broadcast, spawn: spawnDriver,
  scriptB64: await readFile(BASE.script).then((b) => b.toString("base64")).catch(() => null)
});

const hub = createHub({ arms, modes, base, broadcast, phoneUrls: () => phoneUrls(PORT) });

const app = createApp({ dist: DIST, armConfig: ARM_CONFIG, health: hub.health, stats: hub.stats });
const server = http.createServer(app);
wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[bridge] client connected");
  ws.send(JSON.stringify(hub.hello()));
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    hub.handle(ws, msg);
  });
  ws.on("close", () => {
    console.log("[bridge] client disconnected");
    hub.clientLeft(ws);
  });
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { arms.stopAll(); base.stop(); setTimeout(() => process.exit(0), 900); });
}
process.on("exit", () => { arms.stopAll("SIGKILL"); base.kill(); });

/* A port already in use is nearly always a bridge left over from a previous
   run, and the default report for it is an unhandled 'error' event and a
   stack trace. Say what it is and how to clear it instead.

   The listener goes on both the http server and the WebSocketServer: ws
   re-emits the http server's error on itself, and an unhandled 'error' event
   there is what produces the stack trace even when the http server has a
   handler. */
const onServerError = (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[bridge] port ${PORT} is already in use - another bridge is probably still running.`);
    console.error(`[bridge] find it with:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    console.error("[bridge] then kill that pid, or start this one with a different PORT.");
  } else {
    console.error("[bridge]", err.message);
  }
  arms.stopAll();
  base.stop();
  process.exit(1);
};
server.on("error", onServerError);
wss.on("error", onServerError);

server.listen(PORT, () => {
  console.log(`[bridge] http + ws listening on http://localhost:${PORT}`);
  // The phone drive page needs an address it can reach, not localhost.
  for (const u of phoneUrls(PORT)) console.log(`[bridge] phone drive page: ${u}`);
  arms.startAll();
  base.start();
});
