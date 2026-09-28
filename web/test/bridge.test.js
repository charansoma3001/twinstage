import { describe, it, expect, beforeEach, vi } from "vitest";
import { bridgeUrl, createBridgeLink } from "../src/bridge.js";

class FakeSocket {
  static OPEN = 1;
  static all = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.handlers = {};
    FakeSocket.all.push(this);
  }
  addEventListener(kind, fn) { (this.handlers[kind] ||= []).push(fn); }
  fire(kind, ev) { for (const fn of this.handlers[kind] || []) fn(ev); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.fire("close"); }
  open() { this.readyState = 1; this.fire("open"); }
}

beforeEach(() => {
  FakeSocket.all = [];
  globalThis.WebSocket = FakeSocket;
  globalThis.location = { port: "8787", protocol: "http:", host: "10.0.0.5:8787" };
  vi.useFakeTimers();
});

describe("bridgeUrl", () => {
  it("uses the page's own host when the bridge serves the page", () => {
    expect(bridgeUrl({ port: "8787", protocol: "http:", host: "10.0.0.5:8787" })).toBe("ws://10.0.0.5:8787");
    expect(bridgeUrl({ port: "443", protocol: "https:", host: "rig.local:443" })).toBe("wss://rig.local:443");
  });
  it("falls back to the configured URL under the dev server", () => {
    expect(bridgeUrl({ port: "5173", protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:8787");
  });
});

describe("createBridgeLink", () => {
  it("refuses to send until the socket is open", () => {
    const link = createBridgeLink();
    link.connect();
    expect(link.send({ cmd: "x" })).toBe(false);
    FakeSocket.all[0].open();
    expect(link.send({ cmd: "x" })).toBe(true);
    expect(FakeSocket.all[0].sent).toEqual([{ cmd: "x" }]);
  });

  it("parses messages and drops frames that are not JSON", () => {
    const link = createBridgeLink();
    const got = [];
    link.onMessage((m) => got.push(m));
    link.connect();
    FakeSocket.all[0].fire("message", { data: '{"type":"hello"}' });
    FakeSocket.all[0].fire("message", { data: "not json" });
    expect(got).toEqual([{ type: "hello" }]);
  });

  it("reconnects after a drop only when asked to", () => {
    const keep = createBridgeLink({ reconnectMs: 1000 });
    keep.connect();
    FakeSocket.all[0].close();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);

    const once = createBridgeLink();
    once.connect();
    FakeSocket.all[2].close();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it("stays down after disconnect even with reconnect on", () => {
    const link = createBridgeLink({ reconnectMs: 1000 });
    const closes = vi.fn();
    link.onClose(closes);
    link.connect();
    link.disconnect();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(closes).toHaveBeenCalledTimes(1);
  });
});
