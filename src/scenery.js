import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Per-setting environment: sky, fog, ground, and background landscape.
 *
 * Strawberry setting = the Santa Maria Valley (California Central Coast), built
 * as a realistic valley cross-section rather than a ring of hills:
 *
 *   Axes:  +X = east,  -X = west,  +Z = south,  -Z = north
 *
 *   West (-X):  a tall mountain range (San Rafael / Sierra Madre style), distant
 *   East (+X):  a lower coastal ridgeline, then the Pacific beyond it
 *   N/S (±Z):   open valley floor — farmland running to the haze
 *   Highway:    US-101 runs north-south through the valley, just off the field
 */

const SETTINGS = {
  midwest: {
    ground: 'soil',
    region: 'Corn Belt, IA',
    site: { lat: 42.0, lon: -93.5 },
    fog: null, // clear blue-sky day — no haze; the surroundings sit far off instead
    sun: { elevation: 52, azimuth: 150, intensity: 3.4, color: 0xfff4e6 },
    sky: { turbidity: 2, rayleigh: 1.7, mie: 0.004, mieG: 0.82 },
    hemi: { sky: 0xbfd8ff, ground: 0x55502f, intensity: 0.55 },
    ambient: 0.2,
    exposure: 0.74,
  },
  california: {
    ground: 'valley',
    region: 'Santa Maria Valley, CA',
    site: { lat: 34.95, lon: -120.43 },
    fog: { color: 0xcddbe5, near: 260, far: 1200 },
    sun: { elevation: 36, azimuth: 122, intensity: 3.6, color: 0xfff1dc },
    sky: { turbidity: 6, rayleigh: 1.4, mie: 0.006, mieG: 0.78 },
    hemi: { sky: 0xbcd6ef, ground: 0x6f7558, intensity: 0.5 },
    ambient: 0.16,
    exposure: 0.68,
  },
  // Woodland, in the flat Sacramento Valley: hot, hazy, golden June farmland.
  // No coast or marine layer — a high midday sun and dusty distance haze, with
  // the Coast Range and Sierra foothills as low, far silhouettes.
  woodland: {
    ground: 'flatvalley',
    region: 'Sacramento Valley, CA',
    site: { lat: 38.68, lon: -121.77 },
    fog: null, // hot, clear valley day — no fog (distance haze is baked into the terrain instead)
    sun: { elevation: 68, azimuth: 145, intensity: 3.9, color: 0xfff2d4 },
    sky: { turbidity: 9, rayleigh: 1.1, mie: 0.009, mieG: 0.8 },
    hemi: { sky: 0xc9d8ef, ground: 0x7a7044, intensity: 0.5 },
    ambient: 0.18,
    exposure: 0.7,
  },
};

const HAZE = new THREE.Color(0.79, 0.85, 0.89); // marine-layer color
const SEA_LEVEL = -6; // coastal terrain drops to here; ocean plane sits above it

// Valley layout (metres from the field at the origin).
const MTN_START = 130; // west mountains begin this far west
const MTN_FULL = 600; // ...and reach full height by here
const RIDGE_IN = 120; // east ridge rises from here
const RIDGE_CREST = 225;
const RIDGE_OUT = 330; // ...and falls back to the coastal plain by here
const COAST_IN = 330; // beyond here the land descends to the sea
const COAST_SEA = 470;
const HW_X = -70; // highway runs north-south at this easting

// Farmland patchwork: square field cells separated by dirt roads. The home field
// is the centre cell; the dirt road at its edge is the player's walk boundary.
// Farmland: an *irregular* grid of dirt roads, so fields vary in size. The home
// field is a fixed central cell; roads run outward at random spacing.
const HOME_HALF = 36; // coastal home field (strawberry) road lines at ±36 m
const WOOD_HOME = 70; // Woodland's home orchard is ~4x bigger, so its cell is larger
const ROAD_HALF = 2.5; // dirt road half-width
const FARM_W = 200; // grid east-west extent (coastal valley — strawberry)
const FARM_D = 280; // grid north-south extent (open valley)
const WOOD_W = 360; // Woodland reaches much further: orchards run out toward the hills
const WOOD_D = 460;
const HW_HALF = 10; // keep crops out of the highway corridor (road + shoulder)
const HW_LINE_HW = 9; // the highway, as a grid road line, is this half-width

// Building locations (also used to keep crops from growing through them). Each
// setting has its own set so the surroundings read as a different place.
const VALLEY_SITES = [ // Santa Maria coast (strawberry)
  { x: 62, z: -48, r: 17, kind: 'farmstead', rot: 0.4 },
  { x: -45, z: 18, r: 5, kind: 'stand', rot: Math.PI / 2 },
  { x: -50, z: -90, r: 8, kind: 'barn', rot: -0.6 },
];
const WOODLAND_SITES = [ // Sacramento Valley almond country — placed clear of the (large) home orchard
  { x: 105, z: -64, r: 15, kind: 'huller', rot: 0.3 }, // almond hulling/processing yard
  { x: -96, z: 50, r: 7, kind: 'watertower', rot: 0 },
  { x: 88, z: 96, r: 11, kind: 'silos', rot: -0.4 },
];

// Road lines carry their own half-width: dirt roads are narrow, the highway is
// wide. Fields are the gaps *between* lines, so a road never cuts through a
// field — they sit on either side of it. The highway is one of the X lines.
function makeFarmGrid(farmW, farmD, homeHalf, hasHighway) {
  return { linesX: buildLinesX(farmW, homeHalf, hasHighway), linesZ: buildLinesZ(farmD, homeHalf) };
}

function dirt(pos) {
  return { pos, hw: ROAD_HALF };
}

function buildLinesX(farmW, homeHalf, hasHighway) {
  const lines = [dirt(-homeHalf), dirt(homeHalf)];
  // East of the home field: dirt roads.
  let p = homeHalf;
  while (p < farmW) { p += 48 + Math.random() * 80; lines.push(dirt(p)); }
  if (hasHighway) {
    // The highway runs N-S west of the field, with dirt fields on either side.
    lines.push({ pos: HW_X, hw: HW_LINE_HW });
    p = -homeHalf;
    while (p - (48 + 36) > HW_X + 16) { p -= 48 + Math.random() * 36; lines.push(dirt(p)); }
    p = HW_X;
    while (p > -farmW) { p -= 48 + Math.random() * 80; lines.push(dirt(p)); }
  } else {
    // No highway: plain dirt-road grid to the west, like the east.
    p = -homeHalf;
    while (p > -farmW) { p -= 48 + Math.random() * 80; lines.push(dirt(p)); }
  }
  lines.sort((a, b) => a.pos - b.pos);
  return lines;
}

function buildLinesZ(farmD, homeHalf) {
  const lines = [dirt(-homeHalf), dirt(homeHalf)];
  let p = homeHalf;
  while (p < farmD) { p += 48 + Math.random() * 80; lines.push(dirt(p)); }
  p = -homeHalf;
  while (p > -farmD) { p -= 48 + Math.random() * 80; lines.push(dirt(p)); }
  lines.sort((a, b) => a.pos - b.pos);
  return lines;
}

export function buildScenery(scene, settingId, env) {
  const s = SETTINGS[settingId] || SETTINGS.midwest;
  scene.background = null; // the Sky mesh provides the background
  scene.fog = s.fog ? new THREE.Fog(s.fog.color, s.fog.near, s.fog.far) : null;
  if (env) applyAtmosphere(env, s);

  const group = new THREE.Group();
  const updaters = [];
  let walkBound = null;
  let cloudsGroup = null; // the low haze blanket; shown only in drone view (see main.js)
  if (s.ground === 'soil') {
    // Corn Belt: flat maize country to a hazy horizon. Just corn — no roads,
    // buildings, or other crops. A textured ground reads as fields from the air;
    // a low-poly corn ring gives the near surroundings real height on the ground.
    group.add(makeCornBackdrop(6000)); // distant maize fields to the horizon
    group.add(makeHomeSoilPlane(240)); // the home field's brown soil: a square clearing, fields kept well back
  } else if (s.ground === 'flatvalley') {
    // Woodland: flat Central Valley ag land, ringed by other orchards — no ocean,
    // no marine fog, no highway, Central Valley landmarks (water tower, silos, huller).
    const grid = makeFarmGrid(WOOD_W, WOOD_D, WOOD_HOME, false);
    group.add(makeFlatTerrain());
    group.add(makeFarmland(grid, s.ground, WOOD_W, WOOD_D));
    group.add(makeNeighborOrchards(grid, WOODLAND_SITES)); // neighboring orchards, not row crops
    group.add(makeFarmBuildings(WOODLAND_SITES));
    walkBound = WOOD_HOME - 1.5;
  } else {
    // Santa Maria coastal valley (strawberry).
    const grid = makeFarmGrid(FARM_W, FARM_D, HOME_HALF, true);
    group.add(makeValleyTerrain());
    group.add(makeOcean());
    group.add(makeFarmland(grid, s.ground, FARM_W, FARM_D));
    group.add(makeNeighborCrops(grid, VALLEY_SITES)); // real 3D crops in the nearby cells
    group.add(makeFarmBuildings(VALLEY_SITES));
    walkBound = HOME_HALF - 1.5; // the dirt road bounding the home field
    const hw = makeHighway();
    group.add(hw.group);
    updaters.push(hw.update);
    const fog = makeFogBands();
    group.add(fog.group);
    updaters.push(fog.update);
    const clouds = makeLowClouds();
    clouds.group.visible = false; // off on the ground; main.js turns it on for drone view
    group.add(clouds.group);
    updaters.push(clouds.update);
    cloudsGroup = clouds.group;
  }
  scene.add(group);

  return {
    settingId,
    region: s.region,
    site: s.site,
    group,
    walkBound,
    cloudsGroup,
    update(dt) {
      for (const u of updaters) u(dt);
    },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose(); // frees the neighbor-crop instance buffers
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
    },
  };
}

// ---- atmosphere: sun + physical sky --------------------------------------

const _sunDir = new THREE.Vector3();

function applyAtmosphere(env, s) {
  const { sun, hemi, ambient, sky, renderer } = env;

  // Sun direction from elevation/azimuth.
  const phi = THREE.MathUtils.degToRad(90 - s.sun.elevation);
  const theta = THREE.MathUtils.degToRad(s.sun.azimuth);
  _sunDir.setFromSphericalCoords(1, phi, theta);

  // Physical sky (Preetham scattering).
  const u = sky.material.uniforms;
  u.turbidity.value = s.sky.turbidity;
  u.rayleigh.value = s.sky.rayleigh;
  u.mieCoefficient.value = s.sky.mie;
  u.mieDirectionalG.value = s.sky.mieG;
  u.sunPosition.value.copy(_sunDir);

  // Directional sun light along the same direction.
  sun.position.copy(_sunDir).multiplyScalar(120);
  sun.target.position.set(0, 0, 0);
  sun.intensity = s.sun.intensity;
  sun.color.setHex(s.sun.color);

  hemi.color.setHex(s.hemi.sky);
  hemi.groundColor.setHex(s.hemi.ground);
  hemi.intensity = s.hemi.intensity;
  ambient.intensity = s.ambient;

  renderer.toneMappingExposure = s.exposure;
}

// ---- ground textures ------------------------------------------------------

function makeSoilPlane(size) {
  const tex = makeSoilTexture('#6b4a2f', true);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 6, size / 6);
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function makeSoilTexture(base, furrows, fadeEdges) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Speckle with stamps (getImageData/putImageData is far too slow here).
  for (let k = 0; k < 2400; k++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const s = 0.5 + Math.random() * 2.2;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(20,12,6,0.18)' : 'rgba(150,112,76,0.15)';
    ctx.fillRect(x, y, s, s);
  }

  if (furrows) {
    const rows = 8;
    const step = size / rows;
    for (let i = 0; i < rows; i++) {
      const x = i * step + step / 2;
      const g = ctx.createLinearGradient(x - step / 2, 0, x + step / 2, 0);
      g.addColorStop(0, 'rgba(40,26,15,0.55)');
      g.addColorStop(0.5, 'rgba(120,86,55,0.0)');
      g.addColorStop(1, 'rgba(40,26,15,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(x - step / 2, 0, step, size);
    }
  }

  if (fadeEdges) {
    ctx.globalCompositeOperation = 'destination-in';
    const r = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.5);
    r.addColorStop(0, 'rgba(0,0,0,1)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- corn country (midwest surroundings) ----------------------------------
// The home field sits on soil; beyond it a big, low-detail plane of green maize
// fields runs off to a distant horizon under the clear sky. Deliberately far
// away and simple — no roads, buildings, or near clutter.

function makeCornBackdrop(size) {
  const tex = makeCornFieldTexture(size, 2048);
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.05; // sits just under the home soil plane
  mesh.receiveShadow = true;
  return mesh;
}

function cornGridLines(size, minCell, maxCell) {
  const lines = [0];
  let p = 0;
  while (p < size / 2 + maxCell) { p += minCell + Math.random() * (maxCell - minCell); lines.push(p); }
  p = 0;
  while (p > -size / 2 - maxCell) { p -= minCell + Math.random() * (maxCell - minCell); lines.push(p); }
  lines.sort((a, b) => a - b);
  return lines;
}

// Large, soft maize-field blocks. They're only ever seen from a distance, so the
// fields are big and the variation gentle — a calm green patchwork, not busy.
function makeCornFieldTexture(size, res) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = res;
  const ctx = canvas.getContext('2d');
  const greens = ['#557a2e', '#5f8433', '#6b9438', '#4c6f28', '#719b3b', '#638c34', '#517630', '#6c973a'];
  ctx.fillStyle = '#5c7d33';
  ctx.fillRect(0, 0, res, res);

  const w2px = (w) => (w / size + 0.5) * res;
  const linesX = cornGridLines(size, 240, 520);
  const linesZ = cornGridLines(size, 240, 520);
  for (let i = 0; i < linesX.length - 1; i++) {
    for (let j = 0; j < linesZ.length - 1; j++) {
      const x0 = w2px(linesX[i]), x1 = w2px(linesX[i + 1]);
      const z0 = w2px(linesZ[j]), z1 = w2px(linesZ[j + 1]);
      if (x1 < 0 || x0 > res || z1 < 0 || z0 > res) continue;
      ctx.fillStyle = greens[Math.floor(hash(i * 13 + 1, j * 11 + 7) * greens.length)];
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
      const b = 0.92 + hash(i + 3, j + 5) * 0.16; // gentle per-field brightness
      ctx.fillStyle = b >= 1 ? `rgba(255,255,255,${(b - 1) * 0.5})` : `rgba(0,0,0,${(1 - b) * 0.5})`;
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The home field's tilled brown soil: a detailed (repeated) soil texture on a
// square clearing whose straight edges fade out (via an alpha map) so the
// surrounding green fields blend in well back from the field.
function makeHomeSoilPlane(size) {
  const tex = makeSoilTexture('#6b4a2f', true);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 6, size / 6);
  tex.anisotropy = 8;

  // Square alpha mask: opaque centre, straight edges fading to transparent
  // (the product of a horizontal and a vertical edge-fade).
  const ac = document.createElement('canvas');
  ac.width = ac.height = 256;
  const ax = ac.getContext('2d');
  ax.fillStyle = '#ffffff';
  ax.fillRect(0, 0, 256, 256);
  ax.globalCompositeOperation = 'destination-in';
  const f = 0.16; // fraction of each edge that fades
  for (const horiz of [true, false]) {
    const g = horiz ? ax.createLinearGradient(0, 0, 256, 0) : ax.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(f, 'rgba(0,0,0,1)');
    g.addColorStop(1 - f, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ax.fillStyle = g;
    ax.fillRect(0, 0, 256, 256);
  }
  ax.globalCompositeOperation = 'source-over';
  const alpha = new THREE.CanvasTexture(ac);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, alphaMap: alpha, transparent: true, roughness: 1.0 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.receiveShadow = true;
  return mesh;
}

// ---- farmland patchwork (fills the valley floor) --------------------------

const CROP_COLORS = [
  '#4d7a31', '#5b8c36', '#6fa03e', '#7fae45', '#3f6a2a', '#345e26',
  '#86973c', '#9aa648', '#b0a85a', '#a59166', '#7e8a3e', '#5f7d3a',
];

/**
 * Deterministic per-cell field descriptor, shared by the farmland texture and
 * the 3D crops so they agree. Gives the patchwork real variety: some fields are
 * fallow (bare), some freshly tilled, the rest cropped with varied color, row
 * direction/spacing, and 3D crop style.
 */
function cellData(ci, cj) {
  const t = hash(ci * 7 + 50, cj * 5 + 70);
  let kind = 'crop';
  if (t < 0.13) kind = 'fallow';
  else if (t < 0.23) kind = 'tilled';
  const color = CROP_COLORS[Math.floor(hash(ci * 13 + 5, cj * 11 + 9) * CROP_COLORS.length)];
  const rowDir = hash(ci + 3, cj + 9) > 0.5;
  const rowSpacing = 4 + Math.floor(hash(ci + 1, cj + 22) * 5);
  let style = 'none';
  if (kind === 'crop') {
    const sh = hash(ci + 31, cj + 17);
    if (sh < 0.28) style = 'low';
    else if (sh < 0.66) style = 'leafy';
    else if (sh < 0.86) style = 'tall';
    else style = 'sparse';
  }
  return { kind, color, rowDir, rowSpacing, style, bright: 0.88 + hash(ci + 4, cj + 6) * 0.24 };
}

function makeFarmland(grid, ground, farmW, farmD) {
  const W = 2 * farmW; // plane spans the grid extent
  const D = 2 * farmD;
  const tex = makeFarmlandTexture(grid, W, D, 1536, 2048, ground); // wider plane → more texels across X
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, transparent: true })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.receiveShadow = true;
  return mesh;
}

function makeFarmlandTexture(grid, planeW, planeD, texW, texD, ground) {
  const canvas = document.createElement('canvas');
  canvas.width = texW;
  canvas.height = texD;
  const ctx = canvas.getContext('2d');

  // Dirt-road base (everything between cells is dirt).
  ctx.fillStyle = '#9b8358';
  ctx.fillRect(0, 0, texW, texD);
  for (let k = 0; k < 4000; k++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(60,44,26,0.14)' : 'rgba(180,150,110,0.12)';
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * texW, Math.random() * texD, s, s);
  }

  const pxX = (wx) => (wx / planeW + 0.5) * texW;
  const pxZ = (wz) => (wz / planeD + 0.5) * texD;
  const { linesX, linesZ } = grid;

  for (let i = 0; i < linesX.length - 1; i++) {
    for (let j = 0; j < linesZ.length - 1; j++) {
      const wx0 = linesX[i].pos + linesX[i].hw;
      const wx1 = linesX[i + 1].pos - linesX[i + 1].hw;
      const wz0 = linesZ[j].pos + linesZ[j].hw;
      const wz1 = linesZ[j + 1].pos - linesZ[j + 1].hw;
      if (wx1 <= wx0 || wz1 <= wz0) continue;
      const x0 = pxX(wx0);
      const x1 = pxX(wx1);
      const z0 = pxZ(wz0);
      const z1 = pxZ(wz1);
      const cxw = (wx0 + wx1) / 2;
      const czw = (wz0 + wz1) / 2;

      if (Math.abs(cxw) < 2 && Math.abs(czw) < 2) {
        // Home field — its floor depends on the crop growing here.
        if (ground === 'flatvalley') {
          // Almond orchard floor: dry mowed middles with darker tree-row strips.
          ctx.fillStyle = '#7c6f49';
          ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
          drawRows(ctx, x0, z0, x1, z1, true, 'rgba(40,30,16,0.4)', (x1 - x0) / 9);
        } else {
          // Strawberry — dark soil with closely-spaced bed rows running along Z.
          ctx.fillStyle = '#3a2a1b';
          ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
          drawRows(ctx, x0, z0, x1, z1, true, 'rgba(0,0,0,0.28)', 4);
        }
        continue;
      }

      const cd = cellData(i, j);
      let fill, rows, rowCol, rowSp;
      if (cd.kind === 'fallow') {
        fill = '#9a8a63'; rows = false;
      } else if (cd.kind === 'tilled') {
        fill = '#564330'; rows = true; rowCol = 'rgba(0,0,0,0.3)'; rowSp = 4;
      } else {
        fill = cd.color; rows = true; rowCol = 'rgba(0,0,0,0.16)'; rowSp = cd.rowSpacing;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);

      // Per-cell brightness + a couple of soft patches so cells aren't flat.
      const b = cd.bright;
      ctx.fillStyle = b >= 1 ? `rgba(255,255,255,${(b - 1) * 0.6})` : `rgba(0,0,0,${(1 - b) * 0.6})`;
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
      for (let p = 0; p < 3; p++) {
        const bx = x0 + Math.random() * (x1 - x0);
        const bz = z0 + Math.random() * (z1 - z0);
        const br = (x1 - x0) * (0.12 + Math.random() * 0.18);
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.ellipse(bx, bz, br, br * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      if (rows) drawRows(ctx, x0, z0, x1, z1, cd.rowDir, rowCol, rowSp);
    }
  }

  // Elliptical alpha fade at the plane's edge so the farmland blends out.
  //   - Coastal valley (strawberry): a finite farm patch fading into grassland,
  //     so it stays opaque then drops off in a soft ring near the edge.
  //   - Flat valley (Woodland): the whole floor is ag land, so a tight ring reads
  //     as a circular haze. Instead, dissolve very gradually all the way to the
  //     plane edge — no distinct ring, just patchwork thinning into the distance.
  const flat = ground === 'flatvalley';
  ctx.globalCompositeOperation = 'destination-in';
  ctx.save();
  ctx.translate(texW / 2, texD / 2);
  ctx.scale(1, texD / texW);
  const g = ctx.createRadialGradient(0, 0, texW * (flat ? 0.26 : 0.18), 0, 0, texW * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(flat ? 0.0 : 0.8, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-texW, -texD, texW * 2, texD * 2);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function drawRows(ctx, x0, z0, x1, z1, vertical, color, spacing) {
  ctx.fillStyle = color;
  if (vertical) {
    for (let x = x0 + spacing * 0.5; x < x1; x += spacing) ctx.fillRect(x, z0, 1.4, z1 - z0);
  } else {
    for (let z = z0 + spacing * 0.5; z < z1; z += spacing) ctx.fillRect(x0, z, x1 - x0, 1.4);
  }
}

// 3D crops in the cells immediately around the home field (so the boundary
// isn't a flat texture). Low leafy mounds, colored to each cell's crop, in rows.
const CROP_STYLES = {
  low: { row: 1.0, inrow: 0.55, scale: 0.78, hf: 0.5 },
  leafy: { row: 1.3, inrow: 0.7, scale: 1.0, hf: 1.0 },
  tall: { row: 1.7, inrow: 0.95, scale: 1.05, hf: 1.7 },
  sparse: { row: 2.0, inrow: 1.4, scale: 0.92, hf: 0.9 },
};

function makeNeighborCrops(grid, sites) {
  const geo = makeCropMound();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const { linesX, linesZ } = grid;
  const RADIUS = 130; // only the near fields get 3D crops; the rest stay textured

  const items = [];
  const base = new THREE.Color();
  for (let i = 0; i < linesX.length - 1; i++) {
    for (let j = 0; j < linesZ.length - 1; j++) {
      const x0 = linesX[i].pos + linesX[i].hw;
      const x1 = linesX[i + 1].pos - linesX[i + 1].hw;
      const z0 = linesZ[j].pos + linesZ[j].hw;
      const z1 = linesZ[j + 1].pos - linesZ[j + 1].hw;
      if (x1 <= x0 || z1 <= z0) continue;
      const cxw = (x0 + x1) / 2;
      const czw = (z0 + z1) / 2;
      if (Math.abs(cxw) < 2 && Math.abs(czw) < 2) continue; // home field
      if (Math.hypot(cxw, czw) > RADIUS) continue; // far fields stay flat
      const cd = cellData(i, j);
      if (cd.style === 'none') continue; // fallow / tilled cells have no 3D crops
      const st = CROP_STYLES[cd.style];
      base.set(cd.color);

      // Rows along the cell's long axis, spanning its (varied) rectangle.
      const alongX = cd.rowDir;
      const aLo = alongX ? x0 : z0;
      const aHi = alongX ? x1 : z1;
      const bLo = alongX ? z0 : x0;
      const bHi = alongX ? z1 : x1;
      for (let a = aLo; a <= aHi; a += st.row) {
        for (let b = bLo; b <= bHi; b += st.inrow) {
          const wx = (alongX ? a : b) + (Math.random() - 0.5) * 0.25;
          const wz = (alongX ? b : a) + (Math.random() - 0.5) * 0.25;
          if (Math.abs(wx - HW_X) < HW_HALF) continue; // don't plant on the highway
          let blocked = false;
          for (const s of sites) {
            if (Math.hypot(wx - s.x, wz - s.z) < s.r) { blocked = true; break; }
          }
          if (blocked) continue; // leave room for buildings
          items.push({
            x: wx,
            z: wz,
            r: base.r * (0.85 + Math.random() * 0.25),
            g: base.g * (0.85 + Math.random() * 0.25),
            bl: base.b * (0.85 + Math.random() * 0.25),
            s: st.scale * (0.8 + Math.random() * 0.4),
            hf: st.hf,
            rot: Math.random() * Math.PI * 2,
          });
        }
      }
    }
  }

  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    dummy.position.set(it.x, 0.03, it.z);
    dummy.rotation.set(0, it.rot, 0);
    dummy.scale.set(it.s, it.s * it.hf, it.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setRGB(it.r, it.g, it.bl);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function makeCropMound() {
  const geo = new THREE.IcosahedronGeometry(0.32, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(
      i,
      p.getX(i) + (Math.random() - 0.5) * 0.1,
      p.getY(i) + (Math.random() - 0.5) * 0.1,
      p.getZ(i) + (Math.random() - 0.5) * 0.1
    );
  }
  geo.scale(1, 0.7, 1);
  geo.translate(0, 0.18, 0);
  geo.computeVertexNormals();
  return geo;
}

// ---- neighboring orchards (Woodland) --------------------------------------
// The Sacramento Valley signature: the home orchard is surrounded by *other*
// orchards. Each nearby cropped cell is filled with a regular grid of trees
// (one InstancedMesh), so the horizon reads as block after block of orchard
// rather than the coastal patchwork of low row crops.

const NB_TRUNK = new THREE.Color(0.33, 0.23, 0.15);
const NB_CANOPY = new THREE.Color(0.27, 0.42, 0.18);

function vcol(geo, color) {
  geo.deleteAttribute('uv');
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return geo;
}

// One low-poly orchard tree (~2.6 m): brown trunk + a lumpy green crown, baked
// as vertex colors so a single InstancedMesh draws the whole tree. Per-instance
// color is used only as a brightness multiplier for variety.
function makeNeighborTree() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.14, 1.0, 6).toNonIndexed();
  trunk.translate(0, 0.5, 0);
  parts.push(vcol(trunk, NB_TRUNK));

  const blobs = [[0, 1.9, 0, 1.15], [0.5, 1.5, 0.3, 0.8], [-0.45, 1.6, -0.3, 0.8]];
  for (const [bx, by, bz, r] of blobs) {
    const cl = new THREE.IcosahedronGeometry(r, 1);
    const p = cl.attributes.position;
    for (let k = 0; k < p.count; k++) {
      p.setXYZ(
        k,
        p.getX(k) + (Math.random() - 0.5) * r * 0.4,
        p.getY(k) + (Math.random() - 0.5) * r * 0.4,
        p.getZ(k) + (Math.random() - 0.5) * r * 0.4
      );
    }
    cl.scale(1, 0.9, 1);
    cl.translate(bx, by, bz);
    cl.computeVertexNormals();
    parts.push(vcol(cl, NB_CANOPY));
  }
  return mergeGeometries(parts, false);
}

function makeNeighborOrchards(grid, sites) {
  const geo = makeNeighborTree();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const { linesX, linesZ } = grid;
  const SP_ROW = 6.0;
  const SP_TREE = 5.2;

  const items = [];
  for (let i = 0; i < linesX.length - 1; i++) {
    for (let j = 0; j < linesZ.length - 1; j++) {
      const x0 = linesX[i].pos + linesX[i].hw;
      const x1 = linesX[i + 1].pos - linesX[i + 1].hw;
      const z0 = linesZ[j].pos + linesZ[j].hw;
      const z1 = linesZ[j + 1].pos - linesZ[j + 1].hw;
      if (x1 <= x0 || z1 <= z0) continue;
      const cxw = (x0 + x1) / 2;
      const czw = (z0 + z1) / 2;
      if (Math.abs(cxw) < 2 && Math.abs(czw) < 2) continue; // home orchard
      // No circular radius cutoff: every cropped cell in the grid gets trees, so
      // the orchards fill the valley to its edge instead of ending in a ring.
      const cd = cellData(i, j);
      if (cd.kind !== 'crop') continue; // fallow/tilled cells become bare dirt blocks (variety)
      const cellTint = 0.9 + hash(i + 9, j + 4) * 0.2; // each orchard block a touch different

      for (let x = x0 + SP_ROW * 0.5; x < x1; x += SP_ROW) {
        for (let z = z0 + SP_TREE * 0.5; z < z1; z += SP_TREE) {
          const wx = x + (Math.random() - 0.5) * 0.3;
          const wz = z + (Math.random() - 0.5) * 0.3;
          let blocked = false;
          for (const s of sites) {
            if (Math.hypot(wx - s.x, wz - s.z) < s.r) { blocked = true; break; }
          }
          if (blocked) continue;
          items.push({
            x: wx,
            z: wz,
            s: 0.85 + Math.random() * 0.4,
            hy: 0.9 + Math.random() * 0.2,
            rot: Math.random() * Math.PI * 2,
            v: cellTint * (0.85 + Math.random() * 0.25),
          });
        }
      }
    }
  }

  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    dummy.position.set(it.x, 0, it.z);
    dummy.rotation.set(0, it.rot, 0);
    dummy.scale.set(it.s, it.s * it.hy, it.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setRGB(it.v, it.v, it.v);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere(); // span all instances so it isn't wrongly culled when looking away from center
  return mesh;
}

// ---- Central Valley landmarks ---------------------------------------------

function makeWaterTower() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.5, metalness: 0.4 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x7d8184, roughness: 0.6, metalness: 0.5 });
  const H = 11; // height to the tank base
  for (const dx of [-1.6, 1.6]) {
    for (const dz of [-1.6, 1.6]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, H, 6), legMat);
      leg.position.set(dx, H / 2, dz);
      g.add(leg);
    }
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.05, 6, 14), legMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = H * 0.6;
  g.add(ring);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.2, 16), steel);
  tank.position.y = H + 1.6;
  g.add(tank);
  const top = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.4, 16), steel);
  top.position.y = H + 3.9;
  g.add(top);
  const bot = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.2, 16), steel);
  bot.position.y = H - 0.4;
  bot.rotation.x = Math.PI;
  g.add(bot);
  return g;
}

function makeSilos(n) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xd0d3d6, roughness: 0.45, metalness: 0.5 });
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xa9adb1, roughness: 0.5, metalness: 0.5 });
  const R = 1.5;
  const H = 8.5;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (R * 2 + 0.4);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 14), metal);
    body.position.set(x, H / 2, 0);
    g.add(body);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2),
      domeMat
    );
    dome.position.set(x, H, 0);
    g.add(dome);
  }
  return g;
}

// ---- farm buildings -------------------------------------------------------

function makeFarmBuildings(sites) {
  const group = new THREE.Group();
  for (const site of sites) {
    let obj;
    if (site.kind === 'farmstead') {
      obj = new THREE.Group();
      obj.add(place(makeBarn(9, 4.5, 6, 0x8c3327), 0, 0, 0));
      obj.add(place(makeShed(5, 2.8, 4, 0xd8d4c8), -8.5, 0, 1.2));
      obj.add(place(makeShed(4, 2.6, 3.4, 0x9aa0a4), -7.5, 5.5, -0.5));
      obj.add(place(makeHouse(6, 3.2, 5, 0xe6e2d6), 1, 12, 0.3));
    } else if (site.kind === 'stand') {
      obj = makeStand();
    } else if (site.kind === 'huller') {
      // Almond hulling/processing yard: a long steel shed flanked by silos.
      obj = new THREE.Group();
      obj.add(place(makeShed(16, 5, 7, 0xc4c8cc), 0, 0, 0));
      obj.add(place(makeSilos(3), 11, -3, 0));
      obj.add(place(makeShed(7, 3.4, 5, 0x9aa0a4), -1, 9, 0.2));
    } else if (site.kind === 'watertower') {
      obj = makeWaterTower();
    } else if (site.kind === 'silos') {
      obj = makeSilos(4);
    } else {
      obj = makeBarn(8, 4, 5.5, 0x9c6b3a);
    }
    group.add(place(obj, site.x, site.z, site.rot));
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

function place(obj, x, z, rotY) {
  obj.position.set(x, 0, z);
  obj.rotation.y = rotY || 0;
  return obj;
}

function prismRoof(w, h, d) {
  const hw = w / 2;
  const hd = d / 2;
  const pos = [
    -hw, 0, hd, hw, 0, hd, 0, h, hd, // front tri
    -hw, 0, -hd, hw, 0, -hd, 0, h, -hd, // back tri
  ];
  const idx = [
    0, 1, 2, 5, 4, 3, // gable ends
    0, 2, 5, 0, 5, 3, // left slope
    1, 4, 5, 1, 5, 2, // right slope
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeBarn(w, bodyH, d, color) {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.7, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, d), wallMat);
  body.position.y = bodyH / 2;
  g.add(body);
  const roof = new THREE.Mesh(prismRoof(w * 1.06, bodyH * 0.6, d * 1.04), roofMat);
  roof.position.y = bodyH;
  g.add(roof);
  // big door
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.34, bodyH * 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x4a352a, roughness: 0.9 })
  );
  door.position.set(0, bodyH * 0.35, d / 2 + 0.05);
  g.add(door);
  return g;
}

function makeShed(w, h, d, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  body.position.y = h / 2;
  g.add(body);
  // mono-slope roof: a thin box tilted
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w * 1.1, 0.12, d * 1.15),
    new THREE.MeshStandardMaterial({ color: 0x6d7074, roughness: 0.6, metalness: 0.3 })
  );
  roof.position.y = h + 0.18;
  roof.rotation.x = 0.12;
  g.add(roof);
  return g;
}

function makeHouse(w, h, d, color) {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b4a38, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  body.position.y = h / 2;
  g.add(body);
  const roof = new THREE.Mesh(prismRoof(w * 1.08, h * 0.5, d * 1.06), roofMat);
  roof.position.y = h;
  g.add(roof);
  return g;
}

function makeStand() {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b513a, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xb5482f, roughness: 0.7 });
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(4, 1.0, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x9a7c54, roughness: 0.9 })
  );
  counter.position.y = 0.5;
  g.add(counter);
  for (const dx of [-1.8, 1.8]) {
    for (const dz of [-0.7, 0.7]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6), postMat);
      post.position.set(dx, 1.2, dz);
      g.add(post);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 2.4), roofMat);
  roof.position.y = 2.4;
  roof.rotation.x = 0.08;
  g.add(roof);
  return g;
}

// ---- flat Central Valley terrain (Woodland) -------------------------------

// A flat ag-land floor stretching to a hazy horizon, with the Coast Range far
// to the west and the Sierra foothills far to the east — both kept low and
// distant so the valley reads as flat. No ocean.
function makeFlatTerrain() {
  const SIZE = 1700;
  const SEG = 180;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  const pos = geo.attributes.position;
  const n = pos.count;
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  const hh = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i);
    const h = flatHeight(x, z);
    px[i] = x;
    pz[i] = z;
    hh[i] = h;
    pos.setZ(i, h);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const normal = geo.attributes.normal;
  const colors = new Float32Array(n * 3);
  const dryGold = new THREE.Color(0.62, 0.56, 0.32); // summer-dry valley grass
  const agGreen = new THREE.Color(0.32, 0.45, 0.18); // irrigated fields
  const hillBrown = new THREE.Color(0.43, 0.4, 0.27);
  const hillGreen = new THREE.Color(0.24, 0.32, 0.16);
  const soil = new THREE.Color(0.5, 0.42, 0.3);
  const col = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const x = px[i];
    const z = pz[i];
    const h = hh[i];
    const slope = 1 - THREE.MathUtils.clamp(normal.getZ(i), 0, 1);

    const wet = THREE.MathUtils.clamp(0.2 + 0.6 * fbm(x * 0.003 + 10, z * 0.003 + 4), 0, 1);
    col.copy(dryGold).lerp(agGreen, wet * 0.6);
    col.lerp(hillBrown, THREE.MathUtils.clamp(h / 40, 0, 1) * 0.6);
    col.lerp(hillGreen, THREE.MathUtils.clamp((slope - 0.3) / 0.4, 0, 1) * 0.4);
    col.lerp(soil, THREE.MathUtils.clamp((slope - 0.6) / 0.3, 0, 1) * 0.5);
    col.multiplyScalar(0.9 + 0.2 * valueNoise(x * 0.06 + 5, z * 0.06 + 8));

    // No distance haze here: a hot, clear Woodland day stays crisp golden all the
    // way to the hills (the marine-haze lerp lived here and read as a fog ring).

    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 }));
}

function flatHeight(x, z) {
  // Flat valley floor with the faintest swells; distant ranges on either side.
  let h = 0.6 * (fbm(x * 0.015 + 5, z * 0.015 + 9) - 0.5);

  const w = -x - 380; // Coast Range, far west
  if (w > 0) {
    let r = fbm(x * 0.004 + 1, z * 0.004 + 7);
    r = 1 - Math.abs(2 * r - 1);
    h += smooth(THREE.MathUtils.clamp(w / 520, 0, 1)) * (18 + 90 * r * r);
  }

  const e = x - 520; // Sierra foothills, far east
  if (e > 0) {
    let r = fbm(x * 0.005 + 3, z * 0.005 + 2);
    r = 1 - Math.abs(2 * r - 1);
    h += smooth(THREE.MathUtils.clamp(e / 620, 0, 1)) * (14 + 70 * r * r);
  }

  return h;
}

// ---- valley terrain -------------------------------------------------------

function makeValleyTerrain() {
  const SIZE = 1700;
  const SEG = 200;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  const pos = geo.attributes.position;
  const n = pos.count;
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  const hh = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const z = pos.getY(i); // world -z after rotation; symmetric noise, sign irrelevant
    const h = valleyHeight(x, z);
    px[i] = x;
    pz[i] = z;
    hh[i] = h;
    pos.setZ(i, h);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const normal = geo.attributes.normal;
  const colors = new Float32Array(n * 3);
  const grassGreen = new THREE.Color(0.27, 0.43, 0.15);
  const grassGold = new THREE.Color(0.6, 0.55, 0.3);
  const darkGreen = new THREE.Color(0.15, 0.3, 0.1);
  const chaparral = new THREE.Color(0.18, 0.24, 0.11);
  const soil = new THREE.Color(0.46, 0.39, 0.29);
  const beach = new THREE.Color(0.78, 0.72, 0.56);
  const col = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const x = px[i];
    const z = pz[i];
    const h = hh[i];
    const slope = 1 - THREE.MathUtils.clamp(normal.getZ(i), 0, 1);

    const dry = THREE.MathUtils.clamp(0.12 + 0.5 * fbm(x * 0.004 + 30, z * 0.004 + 15), 0, 1);
    col.copy(grassGreen).lerp(grassGold, dry * 0.55);
    const shrub = valueNoise(x * 0.02 + 11, z * 0.02 + 4);
    if (shrub > 0.66) col.lerp(chaparral, ((shrub - 0.66) / 0.34) * 0.75);
    col.lerp(darkGreen, THREE.MathUtils.clamp((slope - 0.22) / 0.4, 0, 1) * 0.45);
    col.lerp(soil, THREE.MathUtils.clamp((slope - 0.58) / 0.35, 0, 1) * 0.6);
    // Sandy beach where the land meets the sea.
    if (h < 1.5) col.lerp(beach, THREE.MathUtils.clamp((1.5 - h) / 3.5, 0, 1) * 0.8);
    col.multiplyScalar(0.9 + 0.22 * valueNoise(x * 0.07 + 5, z * 0.07 + 8));

    // Marine-layer haze: subtle, on distant + low ground; ridge tops stay clear.
    const d = Math.hypot(x, z);
    const haze =
      THREE.MathUtils.clamp((d - 240) / (760 - 240), 0, 1) *
      THREE.MathUtils.clamp(1 - h / 120, 0, 1);
    col.lerp(HAZE, THREE.MathUtils.clamp(haze, 0, 1) * 0.6);

    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 }));
}

function valleyHeight(x, z) {
  // Flat farmland in the valley core; gentle undulation only toward the hills.
  const dCore = Math.max(Math.abs(x) / 120, Math.abs(z) / 320);
  const edge = smooth(THREE.MathUtils.clamp((dCore - 0.6) / 0.4, 0, 1));
  let h = edge * 1.0 * (fbm(x * 0.02 + 5, z * 0.02 + 9) - 0.5);

  // West (-X): a tall ridged mountain range whose crest meanders along N-S.
  const w = -x - MTN_START;
  if (w > 0) {
    const wt = smooth(THREE.MathUtils.clamp(w / (MTN_FULL - MTN_START), 0, 1));
    let wr = fbm(x * 0.0045 + 1, z * 0.0045 + 9);
    wr = 1 - Math.abs(2 * wr - 1);
    wr *= wr; // ridged peaks
    const crest = 0.65 + 0.35 * fbm(x * 0.0012 + 3, z * 0.003 + 20);
    h += wt * crest * (55 + 330 * wr);
  }

  // East (+X): a lower coastal ridgeline (a hump between RIDGE_IN..RIDGE_OUT).
  const e = x;
  const eridge =
    smooth(THREE.MathUtils.clamp((e - RIDGE_IN) / (RIDGE_CREST - RIDGE_IN), 0, 1)) *
    (1 - smooth(THREE.MathUtils.clamp((e - RIDGE_CREST) / (RIDGE_OUT - RIDGE_CREST), 0, 1)));
  if (eridge > 0) {
    let er = fbm(x * 0.006 + 5, z * 0.006 + 3);
    er = 1 - Math.abs(2 * er - 1);
    h += eridge * (45 + 85 * er) * (0.7 + 0.3 * fbm(z * 0.004 + 11, x * 0.004));
  }

  // Beyond the east ridge, descend to the sea.
  const coastT = smooth(THREE.MathUtils.clamp((e - COAST_IN) / (COAST_SEA - COAST_IN), 0, 1));
  h = h * (1 - coastT) + SEA_LEVEL * coastT;
  return h;
}

// ---- ocean ----------------------------------------------------------------

function makeOcean() {
  // A large low plane: hidden wherever the land is above it, visible only where
  // the coast drops below sea level (the eastern shore).
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3200, 3200),
    new THREE.MeshStandardMaterial({ color: 0x1d3c4e, roughness: 0.28, metalness: 0.1 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(700, -3, 0);
  return mesh;
}

// ---- highway (US-101, north-south) ----------------------------------------

function makeHighway() {
  const group = new THREE.Group();
  const LEN = 1100;
  const WIDTH = 16;

  const roadTex = makeRoadTexture();
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, LEN / 14);
  roadTex.anisotropy = 8;
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH, LEN),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(HW_X, 0.05, 0);
  road.receiveShadow = true;
  group.add(road);

  // Power poles down the field side of the road.
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 });
  for (let z = -LEN / 2 + 20; z < LEN / 2; z += 48) {
    group.add(makePole(HW_X + 11, z, woodMat));
  }

  // A few vehicles, two directions, wrapping along the road.
  const carColors = [0xb33a3a, 0x35508f, 0xdadde0, 0x2c2e31, 0xc9a23a];
  const cars = [];
  for (let i = 0; i < carColors.length; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const car = makeCar(carColors[i]);
    car.position.set(HW_X + (dir > 0 ? 3.6 : -3.6), 0.05, -LEN / 2 + i * 210);
    car.rotation.y = dir > 0 ? 0 : Math.PI;
    group.add(car);
    cars.push({ mesh: car, dir, speed: 22 + i * 5 });
  }

  return {
    group,
    update(dt) {
      for (const c of cars) {
        c.mesh.position.z += c.dir * c.speed * dt;
        if (c.mesh.position.z > LEN / 2) c.mesh.position.z -= LEN;
        else if (c.mesh.position.z < -LEN / 2) c.mesh.position.z += LEN;
      }
    },
  };
}

function makeRoadTexture() {
  const w = 64;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#37393d';
  ctx.fillRect(0, 0, w, h);
  // gravel shoulders
  ctx.fillStyle = '#5d554a';
  ctx.fillRect(0, 0, 5, h);
  ctx.fillRect(w - 5, 0, 5, h);
  // white edge lines
  ctx.fillStyle = '#d9dadb';
  ctx.fillRect(8, 0, 2, h);
  ctx.fillRect(w - 10, 0, 2, h);
  // double-yellow centre line
  ctx.fillStyle = '#d8b53a';
  ctx.fillRect(w / 2 - 3, 0, 2, h);
  ctx.fillRect(w / 2 + 1, 0, 2, h);
  // dashed lane lines (one dash per tile)
  ctx.fillStyle = '#d9dadb';
  ctx.fillRect(22, h * 0.12, 2, h * 0.4);
  ctx.fillRect(w - 24, h * 0.12, 2, h * 0.4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePole(x, z, mat) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 7.2, 6), mat);
  post.position.y = 3.6;
  post.castShadow = true;
  g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.09), mat);
  arm.position.y = 6.6;
  g.add(arm);
  g.position.set(x, 0, z);
  return g;
}

function makeCar(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.35 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.2, metalness: 0.4 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 4.2), bodyMat);
  body.position.y = 0.62;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.56, 2.1), glassMat);
  cabin.position.set(0, 1.08, -0.1);
  g.add(cabin);

  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
  for (const dx of [-0.82, 0.82]) {
    for (const dz of [-1.35, 1.35]) {
      const wmesh = new THREE.Mesh(wheel, tireMat);
      wmesh.rotation.z = Math.PI / 2;
      wmesh.position.set(dx, 0.34, dz);
      g.add(wmesh);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---- low drifting clouds (veil the distant fields) ------------------------

// A near-horizontal haze layer: from above, a near-vertical line of sight to the
// home field passes through almost none of it (clear), while grazing lines to
// distant fields pass through a long stretch (veiled) — so the far patchwork
// softens without hiding what's underfoot.
const CLOUD_CLEAR = 42; // radius (m) kept clear over the home field (its corners sit at ~42 m)
const CLOUD_FULL = 47; // ...beyond which the haze is full: a sharp 5 m ramp, so the blanket closes in right at the field edge

function makeLowClouds() {
  const group = new THREE.Group();
  const layers = [];
  const tex0 = makeCloudTexture();
  // Two near-opaque layers drifting in opposite directions: where one layer's
  // cloud texture thins, the other covers it, so beyond the clear hole the
  // surrounding fields read as a solid haze blanket rather than patchy cloud.
  const specs = [
    [18, 1500, 2000, 0.96, 0.004, 0.0022],
    [28, 1800, 2400, 0.94, -0.0032, 0.0015],
  ];
  for (let i = 0; i < specs.length; i++) {
    const [y, w, d, op, sx, sz] = specs[i];
    const tex = i === 0 ? tex0 : tex0.clone();
    tex.needsUpdate = true;
    const mesh = makeCloudPlane(w, d, tex, op);
    mesh.position.y = y;
    mesh.renderOrder = 2;
    group.add(mesh);
    layers.push({ tex, sx, sz });
  }
  return {
    group,
    update(dt) {
      for (const l of layers) {
        l.tex.offset.x += l.sx * dt;
        l.tex.offset.y += l.sz * dt;
      }
    },
  };
}

// Cloud plane with a fixed clear hole over the home field, baked into vertex
// alpha so it stays put while the cloud patches (the texture) drift.
function makeCloudPlane(w, d, tex, op) {
  const geo = new THREE.PlaneGeometry(w, d, 72, 72);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const dist = Math.hypot(pos.getX(i), pos.getY(i)); // plane is centered on the field
    const a = THREE.MathUtils.smoothstep(dist, CLOUD_CLEAR, CLOUD_FULL);
    colors[i * 4] = 1;
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = a;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xeef3f6,
      vertexColors: true,
      transparent: true,
      opacity: op,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true, // distant blanket dissolves into the drone-view scene fog instead of ending at a hard edge
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function makeCloudTexture() {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = i / w;
      const v = j / h;
      const n = fbm(u * 3, v * 3) * 0.6 + fbm(u * 7 + 5, v * 7 + 2) * 0.4;
      let a = THREE.MathUtils.clamp((n - 0.3) / 0.42, 0, 1);
      // Dense blanket: a high opacity floor so there are no see-through gaps,
      // with soft cloud variation on top for a realistic marine layer.
      a = 0.78 + 0.22 * a * a * (3 - 2 * a);
      const k = (j * w + i) * 4;
      d[k] = 255;
      d[k + 1] = 255;
      d[k + 2] = 255;
      d[k + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- drifting mountain fog ------------------------------------------------

function makeFogBands() {
  const group = new THREE.Group();
  const layers = [];
  const fogTex = makeFogTexture();
  const specs = [
    [180, 6, 24, 0.34, 0.01],
    [240, 16, 44, 0.28, 0.014],
    [330, 26, 64, 0.22, -0.008],
  ];
  for (const [radius, y, hgt, op, drift] of specs) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, hgt, 80, 1, true),
      new THREE.MeshBasicMaterial({
        map: fogTex,
        color: 0xdde6ec,
        transparent: true,
        opacity: op,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    mesh.position.y = y;
    group.add(mesh);
    layers.push({ mesh, drift });
  }
  return {
    group,
    update(dt) {
      for (const l of layers) l.mesh.rotation.y += l.drift * dt;
    },
  };
}

function makeFogTexture() {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let j = 0; j < h; j++) {
    const v = j / (h - 1);
    const vBand = Math.sin(v * Math.PI);
    for (let i = 0; i < w; i++) {
      const patch = fbm((i / w) * 6, v * 2 + 3) * fbm((i / w) * 14 + 9, v * 4);
      const a = THREE.MathUtils.clamp(vBand * (0.38 + 1.7 * patch) - 0.1, 0, 1);
      const k = (j * w + i) * 4;
      d[k] = 255;
      d[k + 1] = 255;
      d[k + 2] = 255;
      d[k + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- value-noise fbm ------------------------------------------------------

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function hash(i, j) {
  let n = (i * 374761393 + j * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z) {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j);
  const b = hash(i + 1, j);
  const c = hash(i, j + 1);
  const dd = hash(i + 1, j + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + dd * u * v;
}

function fbm(x, z) {
  let f = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 4; o++) {
    f += amp * valueNoise(x * freq, z * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return f;
}
