import { BRIDGE_URL } from "../config.js";

/* Stage <-> bridge. Unlike the studio link this connects on load and keeps
   reconnecting: the big screen should never need a click to come back. */
let socket = null;
let open = false;
const listeners = new Set();
const openListeners = new Set();

export function isConnected() {
  return open;
}

export function onMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onOpen(fn) {
  openListeners.add(fn);
}

export function send(obj) {
  if (!open || !socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(obj));
  return true;
}

export function connect() {
  if (socket) return;
  // Served by the bridge itself (port 8787) or by Vite in development.
  const url = location.port === "5173" || location.port === ""
    ? BRIDGE_URL
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    open = true;
    for (const fn of openListeners) fn();
  });
  socket.addEventListener("close", () => {
    open = false;
    socket = null;
    for (const fn of listeners) fn({ type: "link", open: false });
    setTimeout(connect, 1000);
  });
  socket.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    for (const fn of listeners) fn(msg);
  });
}
