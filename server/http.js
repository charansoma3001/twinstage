import path from "node:path";
import os from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import express from "express";

const BODY = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"];

// Where a phone on the same network can reach the drive page.
export function phoneUrls(port) {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(`http://${a.address}:${port}/drive`);
    }
  }
  return out;
}

/* A joint map the driver can load: each body joint needs sign +/-1 and a
   finite offset. The gripper entry is optional. */
export function isValidJointMap(body) {
  return !!body && BODY.every((n) => body[n] && (body[n].sign === 1 || body[n].sign === -1) &&
    Number.isFinite(body[n].offset_deg));
}

export function createApp({ dist, armConfig, health, stats }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(dist));
  app.get("/drive", (_req, res) => res.sendFile(path.join(dist, "drive.html")));
  app.get("/settings", (_req, res) => res.sendFile(path.join(dist, "settings.html")));

  app.get("/api/health", (_req, res) => res.json(health()));
  app.get("/api/state", (_req, res) => res.json(stats()));

  /* The joint map is measured in the studio -- the render is the instrument --
     so the browser needs a way to persist what the sliders arrived at.
     Written whole; the driver reads it at startup. One file per arm. */
  const mapPathFor = (req) => armConfig[req.query.arm || "follower"]?.map ?? null;

  app.get("/api/joint-map", async (req, res) => {
    const p = mapPathFor(req);
    if (!p) return res.status(400).json({ error: "unknown arm" });
    try {
      res.json(JSON.parse(await readFile(p, "utf8")));
    } catch {
      res.json(null);
    }
  });

  app.post("/api/joint-map", async (req, res) => {
    const p = mapPathFor(req);
    if (!p) return res.status(400).json({ error: "unknown arm" });
    if (!isValidJointMap(req.body)) {
      return res.status(400).json({ error: "each body joint needs sign +/-1 and a finite offset_deg" });
    }
    await writeFile(p, JSON.stringify(req.body, null, 2) + "\n");
    console.log(`[bridge] ${path.basename(p)} saved; restart the bridge for the driver to pick it up`);
    res.json({ ok: true, path: p });
  });

  return app;
}
