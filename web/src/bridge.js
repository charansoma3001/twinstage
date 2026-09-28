import { BRIDGE_URL, IS_DEMO } from "./config.js";
import { createSimLink, simFetch } from "./sim/simBridge.js";

/* =========================================================================
   Browser <-> bridge WebSocket, shared by both pages.

   The stage connects on load and keeps reconnecting (a big screen should
   never need a click to come back); the settings page connects on demand.
   Messages are JSON both ways; a frame that does not parse is dropped.
   ========================================================================= */

/* Served by the bridge itself, the page's own host is the bridge -- which is
   what makes it work from a phone or another machine. Under the Vite dev
   server (or opened as a file) it is BRIDGE_URL. */
export function bridgeUrl(loc = location) {
  if (loc.port === "5173" || loc.port === "") return BRIDGE_URL;
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}`;
}

/* The bridge's HTTP API. The Pages demo answers it from the simulation. */
export function apiFetch(path, init) {
  return IS_DEMO ? simFetch(path, init) : fetch(path, init);
}

export function createBridgeLink({ reconnectMs = null } = {}) {
  // The Pages demo has no bridge: the page runs one itself. IS_DEMO is fixed
  // at build time, so a normal build drops the simulation entirely.
  if (IS_DEMO) return createSimLink();
  let socket = null;
  let open = false;
  let wanted = false;
  const handlers = { message: new Set(), open: new Set(), close: new Set() };
  const emit = (kind, arg) => { for (const fn of handlers[kind]) fn(arg); };
  const on = (kind) => (fn) => {
    handlers[kind].add(fn);
    return () => handlers[kind].delete(fn);
  };

  function connect() {
    wanted = true;
    if (socket) return;
    try {
      socket = new WebSocket(bridgeUrl());
    } catch (err) {
      console.warn("Bridge connect failed:", err);
      socket = null;
      emit("close");
      return;
    }
    socket.addEventListener("open", () => {
      open = true;
      emit("open");
    });
    socket.addEventListener("close", () => {
      open = false;
      socket = null;
      emit("close");
      if (wanted && reconnectMs !== null) setTimeout(connect, reconnectMs);
    });
    socket.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      emit("message", msg);
    });
  }

  function disconnect() {
    wanted = false;
    if (socket) socket.close();
  }

  function send(obj) {
    if (!open || !socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(obj));
    return true;
  }

  return {
    connect,
    disconnect,
    send,
    isConnected: () => open,
    isLinking: () => !!socket && !open,
    onMessage: on("message"),
    onOpen: on("open"),
    onClose: on("close")
  };
}
