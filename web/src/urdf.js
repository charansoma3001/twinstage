import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

/* =========================================================================
   Minimal URDF reader -- enough for a serial chain with STL visuals.

   Builds one THREE.Group per link. Each joint contributes two nested groups:
   a fixed origin frame (the URDF <origin>) and an actuated rotation inside
   it, so setValue() only ever touches a quaternion.
   ========================================================================= */
const stlLoader = new STLLoader();

const nums = (s) => s.trim().split(/\s+/).map(Number);

function kids(el, tag) {
  return Array.from(el.children).filter(c => c.tagName === tag);
}

function originOf(el) {
  const o = kids(el, "origin")[0];
  return {
    xyz: o && o.getAttribute("xyz") ? nums(o.getAttribute("xyz")) : [0, 0, 0],
    // URDF rpy is fixed-axis roll/pitch/yaw, i.e. R = Rz(y)Ry(p)Rx(r). That is
    // the intrinsic ZYX sequence, which is three's Euler order "ZYX".
    rpy: o && o.getAttribute("rpy") ? nums(o.getAttribute("rpy")) : [0, 0, 0]
  };
}

function applyOrigin(obj, { xyz, rpy }) {
  obj.position.fromArray(xyz);
  obj.rotation.set(rpy[0], rpy[1], rpy[2], "ZYX");
}

export function meshFor(geometry, color) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: color || 0x9ca3af,
    roughness: 0.55,
    metalness: 0.1
  }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export async function loadURDF(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`URDF ${url}: ${res.status} ${res.statusText}`);
  const baseDir = url.slice(0, url.lastIndexOf("/") + 1);
  const robot = parseURDF(await res.text(), {
    label: `URDF ${url}`,
    loadMesh: (file, color) => new Promise((resolve, reject) => {
      stlLoader.load(baseDir + file, (geometry) => resolve(meshFor(geometry, color)), undefined, reject);
    })
  });
  await robot.meshesLoaded;
  return robot;
}

/* Builds the link/joint tree from URDF text. loadMesh(file, color) returns a
   promise of a mesh for each visual; without it the tree is kinematics only.
   meshesLoaded settles once every visual is attached. */
export function parseURDF(text, { loadMesh = null, label = "URDF" } = {}) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error(`${label} is not valid XML`);
  const robotEl = doc.documentElement;

  // Robot-level named materials.
  const materials = {};
  for (const m of kids(robotEl, "material")) {
    const c = kids(m, "color")[0];
    if (!c) continue;
    const [r, g, b] = nums(c.getAttribute("rgba"));
    materials[m.getAttribute("name")] = new THREE.Color(r, g, b);
  }

  const links = {};
  const meshJobs = [];
  for (const linkEl of kids(robotEl, "link")) {
    const name = linkEl.getAttribute("name");
    const group = new THREE.Group();
    group.name = name;
    links[name] = group;

    for (const visual of kids(linkEl, "visual")) {
      const geometry = kids(visual, "geometry")[0];
      const meshEl = geometry && kids(geometry, "mesh")[0];
      if (!meshEl || !loadMesh) continue;
      const file = meshEl.getAttribute("filename").replace(/^package:\/\/[^/]+\//, "");
      const matName = kids(visual, "material")[0]?.getAttribute("name");
      const origin = originOf(visual);
      // CAD exports often keep millimetre STLs and scale them here.
      const scale = meshEl.getAttribute("scale") ? nums(meshEl.getAttribute("scale")) : null;
      meshJobs.push(
        loadMesh(file, materials[matName]).then((mesh) => {
          applyOrigin(mesh, origin);
          if (scale) mesh.scale.fromArray(scale);
          mesh.userData.file = file;
          group.add(mesh);
        })
      );
    }
  }

  const joints = {};
  const childLinks = new Set();
  for (const jointEl of kids(robotEl, "joint")) {
    const name = jointEl.getAttribute("name");
    const type = jointEl.getAttribute("type");
    const parent = kids(jointEl, "parent")[0].getAttribute("link");
    const child = kids(jointEl, "child")[0].getAttribute("link");
    if (!links[parent] || !links[child]) continue;

    const frame = new THREE.Group();
    frame.name = `${name}:origin`;
    applyOrigin(frame, originOf(jointEl));

    const rot = new THREE.Group();
    rot.name = `${name}:rot`;
    frame.add(rot);
    rot.add(links[child]);
    links[parent].add(frame);
    childLinks.add(child);

    const axisEl = kids(jointEl, "axis")[0];
    const axis = new THREE.Vector3(...(axisEl ? nums(axisEl.getAttribute("xyz")) : [0, 0, 1]));
    if (axis.lengthSq() > 0) axis.normalize();

    const limitEl = kids(jointEl, "limit")[0];
    const limit = limitEl
      ? { lower: Number(limitEl.getAttribute("lower")), upper: Number(limitEl.getAttribute("upper")) }
      : null;

    joints[name] = {
      name, type, axis, limit, rot, value: 0,
      setValue(v) {
        if (this.type === "fixed") return;
        if (this.limit) v = Math.max(this.limit.lower, Math.min(this.limit.upper, v));
        this.value = v;
        this.rot.quaternion.setFromAxisAngle(this.axis, v);
      }
    };
  }

  const rootName = Object.keys(links).find(n => !childLinks.has(n));
  if (!rootName) throw new Error(`${label}: no root link (cycle in the joint tree?)`);

  return { root: links[rootName], links, joints, meshesLoaded: Promise.all(meshJobs) };
}
