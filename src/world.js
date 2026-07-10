import * as THREE from 'three';

/**
 * Lighting only. Sky, fog, ground, and background scenery are per-setting and
 * live in scenery.js (so they can change when you switch crops/locations).
 */
export function buildWorld(scene) {
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55502f, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  const s = 60;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);

  return { sun, hemi, ambient };
}
