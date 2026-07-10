import * as THREE from 'three';
import { fieldHealth } from './healthField.js';
import { bandColor } from './bands.js';
import { mulberry32 } from './plantParts.js';
import { CROPS } from './crops.js';
import { asset } from './paths.js';

const SEED = 1337;

// Side length (m) of one frustum-cull chunk. The field is split into a grid of
// InstancedMeshes this size so chunks behind/around the camera cull as a unit
// instead of the whole field being drawn whenever any plant is visible.
const CHUNK = 12;

/**
 * Build a field of one crop as a grid of chunked InstancedMeshes (a Group),
 * plus optional ground decorations (raised plastic-mulch beds for strawberries).
 *
 * Per-plant data (health, basePos) is stored once on the group, indexed by a
 * stable *global* plant id. Each chunk carries a `globalIndices` map from its
 * local instance slot back to that global id, so recoloring and picking work in
 * the global index space regardless of how plants are bucketed into chunks.
 *
 * Coloring uses a custom canopy material:
 *   - RGB view (uBlend = 0): foliage shows per-plant health color (green →
 *     chlorotic), while fruit/flowers keep their real vertex color (red berries).
 *   - Band view (uBlend = 1): the whole plant shows the band/index color.
 */
export function createField(cropId) {
  const crop = CROPS[cropId];
  const rng = mulberry32(SEED);
  const baseGeo = crop.buildPlant(rng);

  // Crops that carry an atlas (e.g. strawberry) get a textured canopy material.
  let map = null;
  if (crop.atlas) {
    map = new THREE.TextureLoader().load(asset(crop.atlas));
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = true;
  }
  const { material, uBlend } = makeCanopyMaterial({ map });

  const layout = crop.layout === 'beds' ? bedPlacements(crop, rng) : rowPlacements(crop, rng);
  const placements = layout.items;
  const count = placements.length;
  const width = layout.width;
  const length = layout.length;

  // Global per-plant data, indexed by global plant id (stable across chunks).
  const health = new Float32Array(count);
  const basePos = new Float32Array(count * 3);

  // Bucket each plant into a spatial grid cell. Consume one rng() per plant for
  // the health jitter in global order, matching the original field exactly.
  const nx = Math.max(1, Math.ceil(width / CHUNK));
  const nz = Math.max(1, Math.ceil(length / CHUNK));
  const minX = -width / 2;
  const minZ = -length / 2;
  const buckets = new Map(); // grid key -> array of global plant ids
  for (let i = 0; i < count; i++) {
    const pl = placements[i];
    basePos[i * 3] = pl.x;
    basePos[i * 3 + 1] = pl.y;
    basePos[i * 3 + 2] = pl.z;
    health[i] = THREE.MathUtils.clamp(fieldHealth(pl.x, pl.z) + (rng() - 0.5) * 0.06, 0.05, 1);

    const ci = THREE.MathUtils.clamp(Math.floor((pl.x - minX) / CHUNK), 0, nx - 1);
    const cj = THREE.MathUtils.clamp(Math.floor((pl.z - minZ) / CHUNK), 0, nz - 1);
    const key = ci * nz + cj;
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push(i);
  }

  // One InstancedMesh per non-empty chunk. Each needs its own geometry clone so
  // it can carry its own per-instance aRgb/aTint attributes; the heavy plant
  // mesh data is small, so the clones are cheap. The material is shared, so the
  // single uBlend uniform still flips the whole field between views at once.
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  for (const idxs of buckets.values()) {
    const n = idxs.length;
    const geo = baseGeo.clone();
    const aRgb = new Float32Array(n * 3);
    const aTint = new Float32Array(n * 3);
    const globalIndices = new Int32Array(n);
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    for (let k = 0; k < n; k++) {
      const gi = idxs[k];
      globalIndices[k] = gi;
      const pl = placements[gi];
      dummy.position.set(pl.x, pl.y, pl.z);
      dummy.rotation.set(0, pl.rot, 0);
      dummy.scale.setScalar(pl.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);

      c.copy(bandColor('rgb', health[gi]));
      aRgb[k * 3] = aTint[k * 3] = c.r;
      aRgb[k * 3 + 1] = aTint[k * 3 + 1] = c.g;
      aRgb[k * 3 + 2] = aTint[k * 3 + 2] = c.b;
    }
    geo.setAttribute('aRgb', new THREE.InstancedBufferAttribute(aRgb, 3));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(aTint, 3));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // span all instances so frustum culling is correct
    mesh.userData.globalIndices = globalIndices;
    group.add(mesh);
  }
  baseGeo.dispose(); // the chunks hold their own clones

  group.userData = {
    health,
    basePos,
    fieldBounds: { width, length },
    cropId,
    name: crop.name,
    decorations: crop.layout === 'beds' ? buildBeds(crop, width, length) : null,
    uBlend,
  };
  return group;
}

// ---- placements -----------------------------------------------------------

function rowPlacements(crop, rng) {
  const width = (crop.rows - 1) * crop.rowSpacing;
  const length = (crop.perRow - 1) * crop.plantSpacing;
  const out = [];
  for (let r = 0; r < crop.rows; r++) {
    for (let p = 0; p < crop.perRow; p++) {
      out.push({
        x: r * crop.rowSpacing - width / 2 + (rng() - 0.5) * 0.08,
        y: 0,
        z: p * crop.plantSpacing - length / 2 + (rng() - 0.5) * 0.08,
        rot: rng() * Math.PI * 2,
        scale: crop.scale[0] + rng() * (crop.scale[1] - crop.scale[0]),
      });
    }
  }
  return { items: out, width, length };
}

function bedPlacements(crop, rng) {
  const width = (crop.beds - 1) * crop.bedSpacing;
  const length = (crop.perBed - 1) * crop.plantSpacing;
  const out = [];
  for (let b = 0; b < crop.beds; b++) {
    const bedX = b * crop.bedSpacing - width / 2;
    for (const side of [-1, 1]) {
      const stagger = side > 0 ? crop.plantSpacing * 0.5 : 0;
      for (let p = 0; p < crop.perBed; p++) {
        out.push({
          x: bedX + side * crop.rowOffset + (rng() - 0.5) * 0.05,
          y: crop.bedHeight,
          z: p * crop.plantSpacing - length / 2 + stagger + (rng() - 0.5) * 0.04,
          rot: rng() * Math.PI * 2,
          scale: crop.scale[0] + rng() * (crop.scale[1] - crop.scale[0]),
        });
      }
    }
  }
  return { items: out, width, length };
}

// ---- raised beds (strawberry) ---------------------------------------------

function buildBeds(crop, width, length) {
  const group = new THREE.Group();
  const span = length + 0.8;
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1.0 });
  const mulchMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.42, metalness: 0.12 });

  const mound = new THREE.BoxGeometry(crop.bedWidth, crop.bedHeight, span);
  const mulch = new THREE.BoxGeometry(crop.bedWidth + 0.06, 0.02, span);

  for (let b = 0; b < crop.beds; b++) {
    const bedX = b * crop.bedSpacing - width / 2;
    const m = new THREE.Mesh(mound, soilMat);
    m.position.set(bedX, crop.bedHeight / 2, 0);
    m.receiveShadow = true;
    group.add(m);
    const pl = new THREE.Mesh(mulch, mulchMat);
    pl.position.set(bedX, crop.bedHeight + 0.005, 0);
    pl.receiveShadow = true;
    group.add(pl);
  }
  return group;
}

// ---- canopy material ------------------------------------------------------

export function makeCanopyMaterial(opts = {}) {
  const map = opts.map || null; // optional texture atlas (see plantParts.ATLAS)
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const uBlend = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBlend = uBlend;
    if (map) shader.uniforms.uAtlas = { value: map };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aRgb;
        attribute vec3 aTint;
        attribute float foliage;
        varying vec3 vRgb;
        varying vec3 vTint;
        varying float vFoliage;
        ${map ? 'attribute vec2 aUv; varying vec2 vUv;' : ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRgb = aRgb; vTint = aTint; vFoliage = foliage;
        ${map ? 'vUv = aUv;' : ''}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uBlend;
        varying vec3 vRgb;
        varying vec3 vTint;
        varying float vFoliage;
        ${map ? 'uniform sampler2D uAtlas; varying vec2 vUv;' : ''}`
      )
      .replace(
        '#include <color_fragment>',
        map
          ? `#include <color_fragment>
        vec4 _tex = texture2D(uAtlas, vUv);
        if (_tex.a < 0.5) discard;                       // leaf-card alpha cutout
        float _lum = dot(_tex.rgb, vec3(0.299, 0.587, 0.114));
        vec3 _nonFol = _tex.rgb * diffuseColor.rgb;      // fruit/flower: texture x base tint
        // leaf/stem: hue follows plant health (green -> chlorotic yellow), while the
        // texture supplies vein shading (luminance) + a touch of leaf-color detail.
        vec3 _detail = _tex.rgb - _lum;                  // texture chroma
        vec3 _fol = vRgb * (0.35 + 1.5 * _lum) + _detail * 0.6;
        vec3 _rgbView = mix(_nonFol, _fol, vFoliage);
        diffuseColor.rgb = mix(_rgbView, vTint, uBlend);`
          : `#include <color_fragment>
        vec3 _rgbView = mix(diffuseColor.rgb, vRgb, vFoliage);
        diffuseColor.rgb = mix(_rgbView, vTint, uBlend);`
      );
  };
  return { material, uBlend };
}
