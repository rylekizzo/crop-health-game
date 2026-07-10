import * as THREE from 'three';

/**
 * Shared helpers for building procedural crop plants.
 *
 * Every part carries two per-vertex attributes used by the canopy shader
 * (see plants.js):
 *   - color   : the part's real base color (green leaf, red berry, ...)
 *   - foliage : 1.0 for leaves/stems (health-tinted in RGB), 0.0 for fruit/flowers
 */

/** Tag a part geometry with a flat color + foliage flag; strip uv for merging. */
export function paintPart(geo, color, foliage = 1) {
  geo.deleteAttribute('uv');
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const fol = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    fol[i] = foliage;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('foliage', new THREE.Float32BufferAttribute(fol, 1));
  return geo;
}

/**
 * Atlas UV cells (see tools/make_strawberry_atlas.py). Three equal thirds:
 * leaf (alpha-cut), fruit, and a solid-white cell for untextured parts.
 * Small horizontal inset avoids sampling across cell seams.
 */
export const ATLAS = {
  leaf: [0.004, 0.329],
  fruit: [0.338, 0.662],
  white: 0.835, // a point anywhere inside the opaque white cell
};

/**
 * Like paintPart, but routes the part through the strawberry texture atlas:
 * remaps the geometry's UVs into `cell` (or pins untextured parts to the white
 * cell) and stores them in a custom `aUv` attribute the canopy shader samples.
 */
export function paintPartUV(geo, color, foliage, cell) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  const fol = new Float32Array(n);
  const uv = new Float32Array(n * 2);

  const src = geo.attributes.uv;
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    fol[i] = foliage;
    if (cell === 'white' || !src) {
      uv[i * 2] = ATLAS.white;
      uv[i * 2 + 1] = 0.5;
    } else {
      const [u0, u1] = ATLAS[cell];
      uv[i * 2] = u0 + src.getX(i) * (u1 - u0);
      uv[i * 2 + 1] = src.getY(i);
    }
  }
  geo.deleteAttribute('uv');
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('foliage', new THREE.Float32BufferAttribute(fol, 1));
  geo.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

/** A flat leaf card lying roughly flat, facing up; the leaf texture's alpha
 *  supplies the actual leaflet silhouette. Length runs along +Z. */
export function makeLeafCard(size) {
  const geo = new THREE.PlaneGeometry(size * 1.5, size * 1.9);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** A curved blade (used for corn leaves). Extends along +X, arcs up, then droops. */
export function makeBlade(length, width, lift, droop) {
  const segments = 10;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = t * length;
    const y = lift * Math.sin(t * Math.PI * 0.55) - droop * t * t;
    const w = width * (0.35 + 0.65 * Math.sin(t * Math.PI)) * (1 - t * 0.15);
    positions.push(x, y, -w / 2);
    positions.push(x, y, w / 2);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** A rounded leaflet lying roughly flat, facing up (used for strawberry leaves). */
export function makeLeaflet(size) {
  const geo = new THREE.CircleGeometry(size, 7);
  geo.rotateX(-Math.PI / 2);
  geo.scale(0.82, 1, 1.3);
  return geo;
}

// Small deterministic RNG so fields are stable across reloads.
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
