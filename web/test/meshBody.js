import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { parseURDF } from "../src/urdf.js";
import { mountSO101, setJoints } from "../src/so101.js";

/* The SO-101 with every mesh vertex, for checking so101Body.js's hull
   against the geometry it was built from. Needs the jsdom environment. */
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/urdf/SO101/");

export async function loadMeshBody() {
  const stl = new STLLoader();
  const cache = {};
  const loadMesh = async (file) => {
    const b = readFileSync(DIR + file);
    cache[file] ??= stl.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    return new THREE.Mesh(cache[file]);
  };
  const robot = parseURDF(readFileSync(DIR + "so101_new_calib.urdf", "utf8"), { loadMesh });
  await robot.meshesLoaded;
  const { holder, toolPoint } = mountSO101(robot);

  // Every distinct vertex of each moving link, in the link's frame.
  const links = [];
  const v = new THREE.Vector3();
  for (const [name, link] of Object.entries(robot.links)) {
    if (name === "base_link") continue;
    const seen = new Map();
    for (const mesh of link.children.filter((c) => c.isMesh)) {
      mesh.updateMatrix();
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
        seen.set(`${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`, [v.x, v.y, v.z]);
      }
    }
    if (seen.size) links.push({ name, node: link, pts: Float64Array.from([...seen.values()].flat()) });
  }

  function reach(q, sign) {
    setJoints(robot, q);
    holder.updateMatrixWorld(true);
    let worst = -Infinity, where = "";
    for (const { name, node, pts } of links) {
      const e = node.matrixWorld.elements;
      for (let i = 0; i < pts.length; i += 3) {
        const x = sign * (e[0] * pts[i] + e[4] * pts[i + 1] + e[8] * pts[i + 2] + e[12]);
        if (x > worst) { worst = x; where = name; }
      }
    }
    return { reach: worst, where };
  }

  const vertices = links.reduce((n, l) => n + l.pts.length / 3, 0);
  return { robot, toolPoint, reach, vertices };
}
