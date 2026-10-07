// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { stlToGLB } from "../../scripts/compress-meshes.mjs";
import { geometryFromGLB } from "../src/urdf.js";

/* The build swaps every STL for a compressed GLB (scripts/compress-meshes.mjs)
   and urdf.js turns it back into flat-shaded geometry. The round trip must
   keep every triangle, the shape and the winding. */
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/urdf/");
const files = [
  ...readdirSync(PUBLIC + "SO101/assets").map((f) => PUBLIC + "SO101/assets/" + f),
  ...readdirSync(PUBLIC + "LeKiwi/meshes").map((f) => PUBLIC + "LeKiwi/meshes/" + f)
].filter((f) => /\.stl$/i.test(f));

function measure(geometry) {
  const p = geometry.getAttribute("position").array;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let volume = 0, area = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3], p[i]);
    max[i % 3] = Math.max(max[i % 3], p[i]);
  }
  return { triangles: p.length / 9, min, max, volume, area };
}

const parseGLB = (glb) => new Promise((resolve, reject) =>
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "", resolve, reject));

describe("compressed meshes", () => {
  it.each(files.map((f) => [path.basename(f), f]))("%s survives the round trip", async (_name, file) => {
    const buf = readFileSync(file);
    const before = measure(new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    const glb = await stlToGLB(buf);
    const after = measure(geometryFromGLB(await parseGLB(glb)));

    expect(glb.length).toBeLessThan(buf.length / 5);
    expect(after.triangles).toBe(before.triangles);
    const size = Math.max(...before.max.map((m, i) => m - before.min[i]));
    for (let i = 0; i < 3; i++) {
      // 16-bit positions: within 1/30000 of the part's size.
      expect(Math.abs(after.min[i] - before.min[i])).toBeLessThan(size / 30000);
      expect(Math.abs(after.max[i] - before.max[i])).toBeLessThan(size / 30000);
    }
    expect(after.area).toBeCloseTo(before.area, -Math.log10(before.area * 1e-3));
    expect(Math.sign(after.volume)).toBe(Math.sign(before.volume));
    expect(Math.abs(after.volume - before.volume)).toBeLessThan(Math.abs(before.volume) * 1e-3);
  }, 30000);
});
