import * as THREE from "three";

/* =========================================================================
   How a twin is lit and what it stands on, shared by the stage and the
   settings page so the arm looks the same in both.
   ========================================================================= */
export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e1d4, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-0.6, 1.4, -0.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -0.8;
  key.shadow.camera.right = key.shadow.camera.top = 0.8;
  key.shadow.radius = 6;
  scene.add(key);
  const warm = new THREE.DirectionalLight(0xffd2a8, 0.45);
  warm.position.set(0.8, 0.6, 0.9);
  scene.add(warm);
}

/* Only the shadow is drawn; the page's gradient is the floor. */
export function addFloor(scene, size = 2.4) {
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.ShadowMaterial({ opacity: 0.14 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  const grid = new THREE.GridHelper(size, Math.round(size * 20), 0xd9cfc0, 0xe7dfd3);
  grid.position.y = 0.0005;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);
}

/* A transparent renderer, so the page's background shows through. */
export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  return renderer;
}
