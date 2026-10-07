/* Shrinks the built robot meshes: STL in, meshopt-compressed GLB out.

   The URDFs ship CAD-export STLs, about 32 MB for the two robots, which
   GitHub Pages serves uncompressed. This runs on the build output only
   (web/public keeps the STLs, which the hull script and the tests read):
   - byte-identical meshes, which the LeKiwi URDF repeats under several
     names, become one file;
   - each mesh is welded, its positions quantized to 16 bits and the
     buffers meshopt-compressed. No triangles are dropped.
   Every URDF under dist/urdf is rewritten to point at the GLBs.
   web/src/urdf.js rebuilds flat normals on load, so the twin looks the same.

   Runs from the Vite build (web/vite.config.js), or by hand:
     node scripts/compress-meshes.mjs dist */
import { readFileSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, basename, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Logger, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { weld, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const stlLoader = new STLLoader();

function stlToDocument(buf) {
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const position = stlLoader.parse(arrayBuffer).getAttribute("position").array;
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = doc.createBuffer();
  const accessor = doc.createAccessor().setType("VEC3").setArray(new Float32Array(position)).setBuffer(buffer);
  const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute("POSITION", accessor));
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  return doc;
}

function urdfFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return urdfFiles(path);
    return extname(name) === ".urdf" ? [path] : [];
  });
}

let io = null;

/* One STL file's bytes in, one GLB's bytes out. */
export async function stlToGLB(buf) {
  if (!io) {
    await MeshoptEncoder.ready;
    io = new NodeIO()
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  }
  const doc = stlToDocument(buf);
  await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: "high", quantizePosition: 16 }));
  return io.writeBinary(doc);
}

export async function compressMeshes(outDir) {
  const before = { files: 0, bytes: 0 };
  const after = { files: 0, bytes: 0 };

  for (const urdfPath of urdfFiles(join(outDir, "urdf"))) {
    const urdfDir = dirname(urdfPath);
    let urdf = readFileSync(urdfPath, "utf8");
    const glbByHash = new Map();   // mesh content hash -> GLB path, relative to the URDF
    const glbByStl = new Map();    // URDF filename attribute -> GLB path

    for (const [, attr] of urdf.matchAll(/filename="([^"]+\.stl)"/gi)) {
      if (glbByStl.has(attr)) continue;
      const rel = attr.replace(/^package:\/\/[^/]+\//, "");
      const stlPath = join(urdfDir, rel);
      const buf = readFileSync(stlPath);
      before.files++;
      before.bytes += buf.length;
      const hash = createHash("sha256").update(buf).digest("hex");
      if (!glbByHash.has(hash)) {
        const glbRel = join(dirname(rel), basename(rel, extname(rel)) + ".glb");
        const glb = await stlToGLB(buf);
        writeFileSync(join(urdfDir, glbRel), glb);
        after.files++;
        after.bytes += glb.length;
        glbByHash.set(hash, glbRel);
      }
      glbByStl.set(attr, glbByHash.get(hash));
      rmSync(stlPath, { force: true });
    }

    urdf = urdf.replace(/filename="([^"]+\.stl)"/gi, (whole, attr) => `filename="${glbByStl.get(attr)}"`);
    writeFileSync(urdfPath, urdf);
  }

  const mb = (n) => (n / 1e6).toFixed(1) + " MB";
  console.log(`meshes: ${before.files} STL, ${mb(before.bytes)} -> ${after.files} GLB, ${mb(after.bytes)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await compressMeshes(relative(process.cwd(), process.argv[2] || "dist"));
}
