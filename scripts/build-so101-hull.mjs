/* Generates web/src/so101-hull.json: for every moving SO-101 link, the mesh
   vertices that are extreme in some direction, in that link's own frame.

   The furthest any mesh reaches along a direction is always reached at one of
   its convex hull's vertices, so a keep-out check only needs those. Taking the
   extreme vertex along 1024 directions spread over the sphere gets within
   ~0.3 mm of the true extent (web/test/so101Body.test.js measures it) with a
   few hundred points instead of the meshes' hundreds of thousands.

   Run after changing the URDF or its meshes:  npm run build:hull */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

globalThis.DOMParser = new JSDOM().window.DOMParser;
const { parseURDF } = await import("../web/src/urdf.js");

const DIR = fileURLToPath(new URL("../web/public/urdf/SO101/", import.meta.url));
const OUT = fileURLToPath(new URL("../web/src/so101-hull.json", import.meta.url));
const DIRECTIONS = 1024;
// The base does not move; everything it carries does.
const FIXED = new Set(["base_link"]);

const stl = new STLLoader();
const geometries = {};
const loadMesh = async (file) => {
  const b = readFileSync(DIR + file);
  geometries[file] ??= stl.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return new THREE.Mesh(geometries[file]);
};

const robot = parseURDF(readFileSync(DIR + "so101_new_calib.urdf", "utf8"), { loadMesh });
await robot.meshesLoaded;

// Directions: a Fibonacci sphere, near-uniform.
const dirs = [];
const golden = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < DIRECTIONS; i++) {
  const y = 1 - (2 * (i + 0.5)) / DIRECTIONS;
  const r = Math.sqrt(1 - y * y);
  dirs.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
}

const hull = {};
const v = new THREE.Vector3();
for (const [name, link] of Object.entries(robot.links)) {
  if (FIXED.has(name)) continue;
  const pts = [];
  for (const mesh of link.children.filter((c) => c.isMesh)) {
    mesh.updateMatrix();
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix).clone());
  }
  if (!pts.length) continue;
  const keep = new Set();
  for (const d of dirs) {
    let best = -Infinity, arg = -1;
    for (let i = 0; i < pts.length; i++) {
      const s = pts[i].dot(d);
      if (s > best) { best = s; arg = i; }
    }
    keep.add(arg);
  }
  // 0.1 mm is far below what the CAD itself is good for.
  const rounded = [...keep].map((i) => pts[i].toArray().map((c) => Math.round(c * 1e4) / 1e4));
  hull[name] = [...new Map(rounded.map((p) => [p.join(","), p])).values()];
}

const total = Object.values(hull).reduce((n, p) => n + p.length, 0);
writeFileSync(OUT, JSON.stringify({ source: "so101_new_calib.urdf", directions: DIRECTIONS, links: hull }) + "\n");
console.log(`${Object.keys(hull).length} links, ${total} points -> ${OUT}`);
