import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintPart, paintPartUV, makeBlade, makeLeaflet, makeLeafCard } from './plantParts.js';

/**
 * Crop definitions. Each crop provides a procedural plant geometry builder
 * (vertex-colored with a foliage mask) plus the field layout parameters.
 *
 * Layout kinds:
 *   'rows' — plants in tilled soil rows (corn) or a widely-spaced orchard grid (almond)
 *   'beds' — two plant rows per raised plastic-mulch bed (strawberry)
 */

// ---- Corn -----------------------------------------------------------------

const CORN_STALK = new THREE.Color(0.3, 0.5, 0.17);
const CORN_LEAF = new THREE.Color(0.34, 0.58, 0.2);
const CORN_TASSEL = new THREE.Color(0.8, 0.7, 0.34);

// A corn tassel: a few near-vertical central spikes plus several thin branches
// that arch up and out from the base and droop at the tips — built from curved
// tubes so it reads as a feathery flowering head rather than a single spike.
// Returned centered at the origin with its base at y = 0.
function makeTassel(rng) {
  const parts = [];

  // Central spikes (the main rachis), rising and slightly splayed. Kept low-poly
  // (triangular tube cross-section) — this geometry is instanced across the whole
  // corn field, so every extra segment multiplies by ~14k plants.
  const spikeCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < spikeCount; i++) {
    const len = 0.17 + rng() * 0.07;
    const lean = new THREE.Vector3((rng() - 0.5) * 0.05, 0, (rng() - 0.5) * 0.05);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lean.x * 0.4, len * 0.5, lean.z * 0.4),
      new THREE.Vector3(lean.x, len, lean.z),
    ]);
    parts.push(new THREE.TubeGeometry(curve, 4, 0.006 - i * 0.0012, 3, false));
  }

  // Branches spreading up and outward around the base — like real corn, they
  // mostly reach upward with only a gentle arch and a slight tip droop.
  const branchCount = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < branchCount; i++) {
    const yaw = (i / branchCount) * Math.PI * 2 + rng() * 0.5;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const out = 0.04 + rng() * 0.03; // horizontal reach (kept modest, so upright)
    const climb = 0.11 + rng() * 0.06; // how high the branch reaches
    const y0 = 0.01 + rng() * 0.05; // where it attaches on the spike
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, y0, 0),
      dir.clone().multiplyScalar(out * 0.45).setY(y0 + climb * 0.5),
      dir.clone().multiplyScalar(out * 0.9).setY(y0 + climb * 0.85),
      dir.clone().multiplyScalar(out).setY(y0 + climb), // tip reaches up, barely droops
    ]);
    parts.push(new THREE.TubeGeometry(curve, 5, 0.0035, 3, false));
  }

  return mergeGeometries(parts, false);
}

function buildCorn(rng) {
  const height = 1.5 + rng() * 0.7;
  const parts = [];

  const stalk = new THREE.CylinderGeometry(0.018, 0.035, height, 6, 1);
  stalk.translate(0, height / 2, 0);
  parts.push(paintPart(stalk, CORN_STALK, 1));

  const leafCount = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < leafCount; i++) {
    const frac = 0.25 + (i / leafCount) * 0.7;
    const leaf = makeBlade(0.5 + rng() * 0.45, 0.13 + rng() * 0.05, 0.18, 0.32 + rng() * 0.2);
    leaf.rotateZ(0.15 + rng() * 0.2);
    leaf.rotateY(i * 2.39 + rng() * 0.5);
    leaf.translate(0, frac * height, 0);
    parts.push(paintPart(leaf, CORN_LEAF, 1));
  }

  // A short tapered neck (truncated cone) bridges the stalk top (r 0.018) down
  // to the thin tassel base, so the stalk doesn't jump abruptly to the tassel.
  const neck = new THREE.CylinderGeometry(0.008, 0.018, 0.08, 6, 1);
  neck.translate(0, height + 0.04, 0);
  parts.push(paintPart(neck, CORN_STALK, 1));

  const tassel = makeTassel(rng);
  tassel.translate(0, height + 0.06, 0);
  parts.push(paintPart(tassel, CORN_TASSEL, 0));

  return mergeGeometries(parts, false);
}

// ---- Strawberry -----------------------------------------------------------

const SB_CROWN = new THREE.Color(0.36, 0.26, 0.16);
const SB_LEAF = new THREE.Color(0.2, 0.46, 0.16);
const SB_PETIOLE = new THREE.Color(0.32, 0.5, 0.2);
const SB_BERRY = new THREE.Color(0.82, 0.11, 0.12);
const SB_CALYX = new THREE.Color(0.3, 0.55, 0.2);
const SB_FLOWER = new THREE.Color(0.96, 0.96, 0.92);
const SB_FLOWER_C = new THREE.Color(0.96, 0.85, 0.25);
const SB_WHITE = new THREE.Color(1, 1, 1); // textured parts: let the atlas supply color

const UP = new THREE.Vector3(0, 1, 0);

// The strawberry plant is texture-mapped through the atlas (tools/make_strawberry_atlas.py):
// leaflets are alpha-cut leaf cards, berries sample the fruit texture, and the
// remaining parts (crown, petioles, calyx, flowers) use the atlas' white cell so
// they keep their flat vertex color. Leaves/stems still health-tint (foliage = 1).
function buildStrawberry(rng) {
  const parts = [];
  const height = 0.17 + rng() * 0.08;

  // Crown at the base.
  const crown = new THREE.SphereGeometry(0.04, 8, 6);
  crown.scale(1, 0.6, 1);
  crown.translate(0, 0.025, 0);
  parts.push(paintPartUV(crown, SB_CROWN, 1, 'white'));

  // Compound leaves (3 leaflets each) on petioles radiating up and out.
  const leafCount = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < leafCount; i++) {
    const yaw = i * 2.39 + rng() * 0.5;
    const el = 0.7 + rng() * 0.45; // elevation angle
    const L = height * (0.7 + rng() * 0.5);
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.sin(yaw),
      Math.sin(el),
      Math.cos(el) * Math.cos(yaw)
    ).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);

    const pet = new THREE.CylinderGeometry(0.005, 0.008, L, 5);
    pet.translate(0, L / 2, 0);
    pet.applyQuaternion(q);
    pet.translate(0, 0.025, 0);
    parts.push(paintPartUV(pet, SB_PETIOLE, 1, 'white'));

    const cc = dir.clone().multiplyScalar(L).add(new THREE.Vector3(0, 0.025, 0));
    for (const k of [-1, 0, 1]) {
      const lf = makeLeafCard(0.085 + rng() * 0.03);
      lf.translate(0, 0, 0.05);
      lf.rotateX(-0.25); // tilt up to follow the petiole
      lf.rotateY(yaw + k * 0.9);
      lf.translate(cc.x, cc.y, cc.z);
      parts.push(paintPartUV(lf, SB_WHITE, 1, 'leaf'));
    }
  }

  // Drooping berries near the perimeter.
  const berryCount = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < berryCount; i++) {
    const yaw = rng() * Math.PI * 2;
    const r = 0.07 + rng() * 0.04;
    const by = 0.04 + rng() * 0.05;
    const berry = new THREE.SphereGeometry(0.024 + rng() * 0.008, 8, 7);
    berry.scale(1, 1.3, 1);
    berry.translate(Math.sin(yaw) * r, by, Math.cos(yaw) * r);
    parts.push(paintPartUV(berry, SB_WHITE, 0, 'fruit'));

    const calyx = new THREE.ConeGeometry(0.016, 0.02, 6);
    calyx.translate(Math.sin(yaw) * r, by + 0.03, Math.cos(yaw) * r);
    parts.push(paintPartUV(calyx, SB_CALYX, 1, 'white'));
  }

  // A flower or two.
  const flowerCount = Math.floor(rng() * 3);
  for (let i = 0; i < flowerCount; i++) {
    const yaw = rng() * Math.PI * 2;
    const r = 0.06 + rng() * 0.03;
    const fy = height * (0.5 + rng() * 0.3);
    const fx = Math.sin(yaw) * r;
    const fz = Math.cos(yaw) * r;
    const petals = new THREE.CircleGeometry(0.03, 10);
    petals.rotateX(-Math.PI / 2);
    petals.translate(fx, fy, fz);
    parts.push(paintPartUV(petals, SB_FLOWER, 0, 'white'));
    const center = new THREE.CircleGeometry(0.012, 8);
    center.rotateX(-Math.PI / 2);
    center.translate(fx, fy + 0.002, fz);
    parts.push(paintPartUV(center, SB_FLOWER_C, 0, 'white'));
  }

  return mergeGeometries(parts, false);
}

// ---- Almond ---------------------------------------------------------------
// A mature orchard tree in early summer (June): short trunk, a few scaffold
// branches lifting a lumpy rounded crown of foliage, with green almond hulls
// developing in the canopy. Bark and hulls keep their real color (foliage = 0);
// only the leaf clusters are health-tinted (foliage = 1).

const AL_BARK = new THREE.Color(0.34, 0.24, 0.15);
const AL_BARK_D = new THREE.Color(0.28, 0.19, 0.12);
const AL_LEAF = new THREE.Color(0.2, 0.4, 0.15);
const AL_HULL = new THREE.Color(0.56, 0.62, 0.34);

function buildAlmond(rng) {
  const parts = [];
  const trunkH = 0.9 + rng() * 0.4;
  const trunkR = 0.12 + rng() * 0.04;

  // Trunk. (toNonIndexed so it merges with the non-indexed foliage icosahedra
  // below — mergeGeometries requires every part to agree on having an index.)
  const trunk = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 8).toNonIndexed();
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paintPart(trunk, AL_BARK, 0));

  // Scaffold branches fanning up and out from the top of the trunk, each ending
  // in a foliage cluster. Collect the cluster centers as we go.
  const crownR = 1.5 + rng() * 0.5; // canopy radius
  const crownTop = trunkH + 1.8 + rng() * 0.8; // height of the crown center
  const scaffolds = 4 + Math.floor(rng() * 3);
  const clusterCenters = [];
  for (let i = 0; i < scaffolds; i++) {
    const yaw = (i / scaffolds) * Math.PI * 2 + rng() * 0.4;
    const el = 0.9 + rng() * 0.4; // mostly upward
    const len = (crownTop - trunkH) * (0.8 + rng() * 0.4);
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.sin(yaw),
      Math.sin(el),
      Math.cos(el) * Math.cos(yaw)
    ).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);

    const br = new THREE.CylinderGeometry(trunkR * 0.35, trunkR * 0.7, len, 6).toNonIndexed();
    br.translate(0, len / 2, 0);
    br.applyQuaternion(q);
    br.translate(0, trunkH, 0);
    parts.push(paintPart(br, AL_BARK_D, 0));

    clusterCenters.push(dir.clone().multiplyScalar(len).add(new THREE.Vector3(0, trunkH, 0)));
  }
  clusterCenters.push(new THREE.Vector3(0, crownTop, 0)); // central top cluster

  // Foliage clusters: deformed icosahedra that overlap into a lumpy crown.
  for (const cc of clusterCenters) {
    const r = crownR * (0.5 + rng() * 0.35);
    const cl = new THREE.IcosahedronGeometry(r, 1);
    const p = cl.attributes.position;
    for (let k = 0; k < p.count; k++) {
      p.setXYZ(
        k,
        p.getX(k) + (rng() - 0.5) * r * 0.5,
        p.getY(k) + (rng() - 0.5) * r * 0.5,
        p.getZ(k) + (rng() - 0.5) * r * 0.5
      );
    }
    cl.scale(1, 0.85, 1);
    cl.translate(cc.x, cc.y, cc.z);
    cl.computeVertexNormals();
    parts.push(paintPart(cl, AL_LEAF, 1));
  }

  // Developing almonds (green hulls) tucked through the canopy.
  const hulls = 8 + Math.floor(rng() * 10);
  for (let i = 0; i < hulls; i++) {
    const yaw = rng() * Math.PI * 2;
    const rr = crownR * (0.4 + rng() * 0.6);
    const hy = crownTop - rng() * (crownTop - trunkH) * 0.7;
    const hull = new THREE.SphereGeometry(0.05 + rng() * 0.02, 5, 4).toNonIndexed();
    hull.scale(0.8, 1.25, 0.8);
    hull.translate(Math.sin(yaw) * rr, hy, Math.cos(yaw) * rr);
    parts.push(paintPart(hull, AL_HULL, 0));
  }

  return mergeGeometries(parts, false);
}

// ---- Registry -------------------------------------------------------------

export const CROPS = {
  corn: {
    id: 'corn',
    name: 'Corn',
    setting: 'midwest',
    layout: 'rows',
    buildPlant: buildCorn,
    rows: 96,
    perRow: 144,
    rowSpacing: 0.75,
    plantSpacing: 0.35,
    scale: [0.9, 1.15],
  },
  strawberry: {
    id: 'strawberry',
    name: 'Strawberry',
    setting: 'california',
    layout: 'beds',
    buildPlant: buildStrawberry,
    atlas: '/assets/textures/strawberry_atlas.png',
    beds: 56,
    perBed: 192,
    bedSpacing: 1.1,
    bedWidth: 0.62,
    bedHeight: 0.16,
    rowOffset: 0.16, // two plant rows per bed, ± this from center
    plantSpacing: 0.3,
    scale: [0.85, 1.15],
  },
  almond: {
    id: 'almond',
    name: 'Almond',
    setting: 'woodland',
    layout: 'rows', // an orchard grid: widely spaced trees in rows
    buildPlant: buildAlmond,
    rows: 20, // ~4x the area of the original 10x12 block
    perRow: 24,
    rowSpacing: 6.4, // ~21 ft between rows
    plantSpacing: 5.5, // ~18 ft down the row
    scale: [0.9, 1.12],
  },
};

export const CROP_IDS = ['corn', 'strawberry', 'almond'];
