import * as THREE from 'three';
import { buildWorld } from './world.js';
import { buildScenery } from './scenery.js';
import { createField } from './plants.js';
import { CROP_IDS, CROPS } from './crops.js';
import { Controller } from './controller.js';
import { Drone } from './drone.js';
import { SatelliteView } from './satellite.js';
import { LI600, VIEW_LAYER } from './li600.js';
import { truePhysiology } from './healthField.js';
import { buildPests } from './pests.js';
import { BANDS, BAND_BY_ID, bandColor, legendGradient } from './bands.js';
import { drawSpectralGraph } from './spectralGraph.js';
import { Mission } from './story.js';
import { Sky } from 'three/addons/objects/Sky.js';

const CLAMP_RANGE = 3.0;

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The field and scenery are static, so re-rendering the shadow map every frame
// is pure waste (it doubles the scene's vertex work). Freeze it and request a
// single refresh only when the field/scenery/scale changes.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic response for the HDR sky
renderer.toneMappingExposure = 0.68;
document.body.appendChild(renderer.domElement);

// --- Scene & camera ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3000);

// --- World, atmosphere, controller ---
const env = buildWorld(scene);
const sky = new Sky();
sky.scale.setScalar(2500);
sky.renderOrder = -1;
scene.add(sky);
env.sky = sky;
env.renderer = renderer;

let cropIndex = 0;
let field, health, basePos, walkBound, flyBound;
// Stress-meter bounds, recomputed per field: the worst plant's stress and the
// "close to but below it" threshold the player must reach by measuring.
let worstStress = 0.9, stressThreshold = 0.8, maxStressMeasured = 0;
let pests = null;        // strawberry aphid system (flags, aphids, ladybugs), null otherwise
let dropping = false;    // holding the release button in the strawberry drone
let inDialogue = false;  // a level-completion dialogue is open
let scenery = buildScenery(scene, CROPS[CROP_IDS[cropIndex]].setting, env);
if (scenery.walkBound != null) walkBound = scenery.walkBound;

// The valley vista's fog (set by buildScenery); restored whenever we're not in
// drone view. In drone view we swap in a tighter marine-layer fog (below) so the
// landscape beyond the field — including the mountains — dissolves into haze.
let baseFog = scene.fog;
const DRONE_FOG = new THREE.Fog(0xeef3f6, 100, 300); // near=100 m keeps the field crisp; far=300 m whites out the distance

function installField(cropId) {
  field = createField(cropId);
  scene.add(field);
  if (field.userData.decorations) scene.add(field.userData.decorations);
  health = field.userData.health;
  basePos = field.userData.basePos;
  const fb = field.userData.fieldBounds;
  walkBound = Math.max(fb.width, fb.length) / 2 + 8;
  flyBound = Math.max(fb.width, fb.length) / 2 + 20;
  renderer.shadowMap.needsUpdate = true; // new geometry → refresh the frozen shadow map once

  // Stress-meter bounds from this field's most-stressed plant.
  let minH = 1;
  for (let i = 0; i < health.length; i++) if (health[i] < minH) minH = health[i];
  worstStress = 1 - minH;
  stressThreshold = worstStress * 0.88; // reach close to, but not exactly, the worst
  maxStressMeasured = 0;

  // Aphid pest system only on the strawberry level.
  if (pests) { scene.remove(pests.group); pests.dispose(); pests = null; }
  if (cropId === 'strawberry') {
    pests = buildPests(basePos, health, field.userData.fieldBounds);
    scene.add(pests.group);
  }
}
installField(CROP_IDS[cropIndex]);

const controller = new Controller(camera, renderer.domElement);
scene.add(controller.object);

// --- Drone (third-person, drone scale) ---
const drone = new Drone();
scene.add(drone.group);
controller.setDrone(drone);

// The drone is a physical object: it sits landed on the ground a bit behind and
// off-centre from the player's start. You must be near it to board it (Tab).
const DRONE_HOME = new THREE.Vector3(7, 0.15, 32); // within every crop's walk bound
const DRONE_NEAR = 5.0; // metres

function landDrone() {
  drone.group.visible = true;
  drone.group.position.copy(DRONE_HOME);
  drone.group.rotation.set(0, -2.2, 0);
  drone.tilt.rotation.set(0, 0, 0);
  drone.tilt.position.y = 0;
}
function nearDrone() {
  const p = controller.object.position;
  const dx = p.x - DRONE_HOME.x, dz = p.z - DRONE_HOME.z;
  return dx * dx + dz * dz < DRONE_NEAR * DRONE_NEAR;
}
landDrone(); // start with it parked

// --- Satellite (orbital scale) — its own scene/camera/controls ---
const satellite = new SatelliteView(renderer);
satellite.setSite(scenery.site.lat, scenery.site.lon); // aim it at the starting field's location

// Snap-to-location buttons (visible only in the satellite scale).
for (const btn of document.querySelectorAll('#sat-locations button')) {
  btn.addEventListener('click', () => {
    satellite.flyToLocation(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon));
  });
}

// --- Held instrument (proximal only) ---
const li600 = new LI600();
camera.add(li600.group);
for (const light of LI600.makeViewLights()) camera.add(light);

// --- Target highlight ring (proximal) ---
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.28, 0.36, 24),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.02;
ring.visible = false;
scene.add(ring);

// --- Crosshair pick ---
// Find the plant nearest the line of sight, by distance, instead of raycasting
// against every instance's triangles. We already store every plant's position,
// so this is a flat loop over basePos: project each plant onto the view ray and
// keep the closest one to that ray within arm's reach.
const AIM_CONE = 0.35; // m: max perpendicular distance from the ray to count as aimed
const AIM_RISE = 0.18; // m: aim a little above the plant base, toward the canopy
let aimedInstance = -1;
let measuredInstance = -1;
const tmpVec = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _toPlant = new THREE.Vector3();

function aimedPlant() {
  camera.getWorldPosition(_camPos);
  camera.getWorldDirection(_camDir); // unit vector
  let best = -1;
  let bestPerp2 = AIM_CONE * AIM_CONE;
  for (let i = 0; i < health.length; i++) {
    _toPlant.set(
      basePos[i * 3] - _camPos.x,
      basePos[i * 3 + 1] + AIM_RISE - _camPos.y,
      basePos[i * 3 + 2] - _camPos.z
    );
    const t = _toPlant.dot(_camDir); // signed distance along the ray
    if (t <= 0 || t > CLAMP_RANGE) continue; // behind us or out of range
    const perp2 = _toPlant.lengthSq() - t * t; // squared distance from the ray
    if (perp2 < bestPerp2) {
      bestPerp2 = perp2;
      best = i;
    }
  }
  return best;
}

// --- Scale & band state ---
const SCALE_ORDER = ['proximal', 'drone', 'satellite'];
let scale = 'proximal';
let bandId = 'rgb';
const tintColor = new THREE.Color();

function recolorField(id) {
  const uBlend = field.userData.uBlend;
  if (id === 'rgb') {
    uBlend.value = 0; // foliage shows health color, fruit keeps real color
    return;
  }
  uBlend.value = 1; // whole canopy shows the band color
  // Tint lives per-chunk now; map each chunk's local slots back to global ids.
  for (const chunk of field.children) {
    const gi = chunk.userData.globalIndices;
    const aTint = chunk.geometry.getAttribute('aTint');
    for (let k = 0; k < gi.length; k++) {
      tintColor.copy(bandColor(id, health[gi[k]]));
      aTint.setXYZ(k, tintColor.r, tintColor.g, tintColor.b);
    }
    aTint.needsUpdate = true;
  }
}

// --- UI references ---
const overlay = document.getElementById('overlay');
const crosshair = document.getElementById('crosshair');
const prompt = document.getElementById('prompt');
const readout = document.getElementById('readout');
const hudCrop = document.getElementById('hud-crop');
const hudScale = document.getElementById('hud-scale');
const hudPos = document.getElementById('hud-pos');
const hudFps = document.getElementById('hud-fps');
const hudAltRow = document.getElementById('hud-alt-row');
const hudAlt = document.getElementById('hud-alt');
const legend = document.getElementById('band-legend');
const lgTitle = document.getElementById('lg-title');
const lgBar = document.getElementById('lg-bar');
const lgLo = document.getElementById('lg-lo');
const lgHi = document.getElementById('lg-hi');
const lgNote = document.getElementById('lg-note');
const lgKeys = document.getElementById('lg-keys');
const spectralCanvas = document.getElementById('spectral-canvas');

// Guided crop-scout mission (story + objectives + hints).
const mission = new Mission();
// Completing the satellite objective: the player hovers both the highest- and
// lowest-NDVI states on the CONUS map.
satellite.onExtremesFound = () => mission.sync({ satExtremes: true });

// A completion dialogue opened → release the cursor so its button is clickable
// (without popping the intro overlay).
mission.onDialogueOpen = () => {
  inDialogue = true;
  if (controller.locked) controller.controls.unlock();
};
// The dialogue's button was pressed → advance to the next level (or finish).
mission.onLevelComplete = (next) => {
  inDialogue = false;
  if (next === 'strawberry') {
    setScale('proximal');
    goToCrop(CROP_IDS.indexOf('strawberry'));
    mission.startLevel('strawberry');
  }
  controller.lock(); // resume play (this click is a user gesture)
};

function renderBandKeys(activeId) {
  lgKeys.innerHTML = BANDS.map(
    (b) => `<span class="lg-band${b.id === activeId ? ' active' : ''}"><kbd>${b.key}</kbd> ${b.id.toUpperCase()}</span>`
  ).join(' &nbsp; ');
}

function setBand(id) {
  bandId = id;
  recolorField(id);
  satellite.setBand(id);
  const b = BAND_BY_ID[id];
  lgTitle.textContent = b.label;
  lgBar.style.background = legendGradient(id);
  lgLo.textContent = b.legend.lo;
  lgHi.textContent = (b.legend.unit ? b.legend.unit + '  ·  ' : '') + b.legend.hi;
  lgNote.textContent = b.note;
  renderBandKeys(id);
  drawSpectralGraph(spectralCanvas, id);
  mission.sync({ band: id });
}

const SCALE_LABEL = {
  proximal: 'proximal (ground)',
  drone: 'drone (aerial)',
  satellite: 'satellite (orbital)',
};

function setScale(next) {
  if (next === scale) return;
  const prev = scale;
  scale = next;
  document.body.dataset.scale = next;
  hudScale.textContent = SCALE_LABEL[next];

  // Coming back from the satellite (which renders its own scene/lights), refresh
  // the frozen shadow map once so the field's shadows are valid again.
  if (prev === 'satellite') renderer.shadowMap.needsUpdate = true;

  // Controls: field scales use pointer lock; satellite uses orbit (free cursor).
  satellite.setActive(next === 'satellite');
  if (next === 'satellite') {
    if (controller.locked) controller.controls.unlock();
    overlay.classList.add('hidden');
  } else {
    controller.setMode(next === 'drone' ? 'fly' : 'walk');
    if (prev === 'satellite' && !controller.locked) controller.lock(); // re-engage (Tab = user gesture)
  }

  // Scale-specific UI / visuals.
  if (next === 'proximal') {
    li600.group.visible = true;
    bandId = 'rgb';
    setBand('rgb'); // ground view is always true color
    landDrone(); // park the drone back on the ground
  } else {
    li600.group.visible = false;
    li600.release();
    readout.classList.remove('show');
    inspectPanel.classList.remove('show');
    ring.visible = false;
    measuredInstance = -1;
    setBand(bandId); // apply current band to canopy + globe tile
  }

  updateHaze();
  mission.sync({ scale: next });
}

// The low haze blanket reads as fog over the landscape from the air, but on the
// ground it's just a wall around you — so show it only in drone view, paired
// with real distance fog that dissolves the rest of the landscape into haze.
function updateHaze() {
  const droneHaze = scale === 'drone' && scenery.cloudsGroup != null;
  if (scenery.cloudsGroup) scenery.cloudsGroup.visible = scale === 'drone';
  scene.fog = droneHaze ? DRONE_FOG : baseFog;
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.isInstancedMesh) o.dispose(); // frees the instance matrix/color GPU buffers
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

function cycleCrop() {
  goToCrop((cropIndex + 1) % CROP_IDS.length);
}

function goToCrop(nextIndex) {
  if (nextIndex === cropIndex) return;
  const oldField = field;

  // Build the new field FIRST. installField reassigns `field` only on success,
  // so if createField throws we bail out here with the current scene untouched
  // (rather than tearing down the old field and stranding the player).
  installField(CROP_IDS[nextIndex]);
  cropIndex = nextIndex;

  // New field is up — now tear down the old one + its decorations.
  scene.remove(oldField);
  if (oldField.userData.decorations) scene.remove(oldField.userData.decorations);
  disposeObject(oldField);
  if (oldField.userData.decorations) disposeObject(oldField.userData.decorations);

  hudCrop.textContent = field.userData.name;

  // Swap the location/scenery if this crop lives somewhere else.
  const setting = CROPS[CROP_IDS[cropIndex]].setting;
  if (setting !== scenery.settingId) {
    scenery.dispose();
    scenery = buildScenery(scene, setting, env);
    baseFog = scene.fog; // buildScenery set a fresh valley fog; capture it before updateHaze may swap it
    updateHaze(); // freshly built scenery starts hidden; re-apply for the current scale
    satellite.setSite(scenery.site.lat, scenery.site.lon); // move the orbital site to this field
  }
  if (scenery.walkBound != null) walkBound = scenery.walkBound;

  // Reset interaction state (instance ids are no longer valid).
  li600.release();
  readout.classList.remove('show');
  inspectPanel.classList.remove('show');
  ring.visible = false;
  measuredInstance = -1;
  aimedInstance = -1;

  setBand(bandId); // re-apply the active band to the new canopy
}

// --- Result panel (proximal) ---
const elETR = document.getElementById('r-etr');
const elGsw = document.getElementById('r-gsw');
const elPhi = document.getElementById('r-phi');
const elFvfm = document.getElementById('r-fvfm');
const elTag = document.getElementById('r-tag');

// Pest-inspection panel (strawberry).
const inspectPanel = document.getElementById('inspect');
const iLevel = document.getElementById('i-level');
const iCount = document.getElementById('i-count');
const iTag = document.getElementById('i-tag');

li600.onResult = (v) => {
  elETR.textContent = v.etr.toFixed(0);
  elGsw.textContent = v.gsw.toFixed(3);
  elPhi.textContent = v.phiPSII.toFixed(3);
  elFvfm.textContent = v.fvfmPrime.toFixed(3);
  const h = v.health;
  let label, color;
  if (h > 0.7) { label = 'Healthy'; color = '#8bc53f'; }
  else if (h > 0.45) { label = 'Mild stress'; color = '#d8c13a'; }
  else { label = 'Stressed'; color = '#d87b3a'; }
  elTag.textContent = label;
  elTag.style.background = color;
  elTag.style.color = '#10240a';
  ring.material.color.set(color);
  readout.classList.add('show');
  inspectPanel.classList.remove('show');
  maxStressMeasured = Math.max(maxStressMeasured, 1 - h);
  mission.sync({
    measured: true,
    health: h,
    maxStress: maxStressMeasured,
    meterMax: worstStress,
    meterThreshold: stressThreshold,
  });
};

// Pest scouting (strawberry): inspect a plant for aphids with I.
function inspectPlant(idx) {
  const h = health[idx];
  const count = Math.max(0, Math.round((1 - h) * 320 - 20));
  let level, tag, color;
  if (h < 0.3) { level = 'Heavy'; tag = 'Aphids — heavy infestation'; color = '#c0392b'; }
  else if (h < 0.45) { level = 'Moderate'; tag = 'Aphids — infested'; color = '#d87b3a'; }
  else if (h < 0.65) { level = 'Light'; tag = 'A few aphids'; color = '#d8c13a'; }
  else { level = 'None'; tag = 'Clean'; color = '#8bc53f'; }
  iLevel.textContent = level;
  iCount.textContent = count;
  iTag.textContent = tag;
  iTag.style.background = color;
  iTag.style.color = '#10240a';
  inspectPanel.classList.add('show');
  readout.classList.remove('show');
  if (h < 0.45) mission.sync({ inspectedPest: true });
}

// --- Input ---
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    // Board the drone only when standing near it; Tab again lands & exits.
    // (Satellite is reached another way — added later.)
    if (scale === 'proximal' && nearDrone()) setScale('drone');
    else if (scale === 'drone') setScale('proximal');
    return;
  }
  if (e.code === 'KeyF' && !e.repeat) {
    cycleCrop();
    return;
  }
  if (e.code === 'KeyH' && !e.repeat) {
    mission.toggleHint();
    return;
  }
  if (scale === 'drone' || scale === 'satellite') {
    const b = BANDS.find((x) => x.key === e.key);
    if (b) setBand(b.id);
    return;
  }
  // proximal: inspect a plant for pests (strawberry level)
  if (e.code === 'KeyI' && !e.repeat) {
    if (scale === 'proximal' && li600.state === 'idle' && aimedInstance >= 0) inspectPlant(aimedInstance);
    return;
  }
  // proximal: clamp / new reading
  if (e.code === 'KeyE' && !e.repeat) {
    if (li600.state === 'idle' && aimedInstance >= 0) {
      measuredInstance = aimedInstance;
      li600.startMeasure(truePhysiology(health[measuredInstance]));
    } else if (li600.state === 'result') {
      li600.release();
      measuredInstance = -1;
      readout.classList.remove('show');
    }
  }
});

// --- Pointer lock ---
overlay.addEventListener('click', () => controller.lock());
renderer.domElement.addEventListener('click', () => {
  if (scale !== 'satellite' && !controller.locked) controller.lock();
});
// Hold the mouse button to release ladybugs from the strawberry drone.
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0 && scale === 'drone' && CROP_IDS[cropIndex] === 'strawberry') dropping = true;
});
window.addEventListener('mouseup', () => { dropping = false; });

controller.controls.addEventListener('lock', () => {
  overlay.classList.add('hidden');
  if (!mission.started) mission.startLevel('corn'); // begin level 1 on first entry
});
controller.controls.addEventListener('unlock', () => {
  // Don't pop the intro overlay while a completion dialogue is open.
  if (scale !== 'satellite' && !inDialogue) overlay.classList.remove('hidden');
});

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  satellite.resize();
});

// --- Loop ---
const clock = new THREE.Clock();
let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;

function setRing(instance, color) {
  if (instance < 0) { ring.visible = false; return; }
  ring.position.set(basePos[instance * 3], basePos[instance * 3 + 1] + 0.02, basePos[instance * 3 + 2]);
  if (color) ring.material.color.set(color);
  ring.visible = true;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (scale === 'satellite') {
    satellite.update(dt);
  } else {
    controller.update(dt, scale === 'drone' ? flyBound : walkBound);
    scenery.update(dt);
    if (pests) {
      pests.update(dt);
      // Strawberry drone: hold the button to release ladybugs over the patch.
      if (scale === 'drone' && dropping) {
        const cov = pests.treatAt(drone.group.position.x, drone.group.position.z, 7.0);
        mission.sync({ coverage: cov });
      }
    }
  }

  if (scale === 'proximal') {
    li600.update(dt);
    if (li600.state === 'idle') {
      if (controller.locked && nearDrone()) {
        // Standing by the drone: prompt to board it instead of measuring.
        aimedInstance = -1;
        crosshair.classList.remove('targeting');
        prompt.innerHTML = '<kbd>Tab</kbd> board the drone';
        prompt.classList.add('show');
        if (measuredInstance < 0) setRing(-1);
      } else {
        aimedInstance = controller.locked ? aimedPlant() : -1;
        crosshair.classList.toggle('targeting', aimedInstance >= 0);
        if (aimedInstance >= 0) {
          prompt.innerHTML = CROP_IDS[cropIndex] === 'strawberry'
            ? '<kbd>I</kbd> inspect for pests'
            : '<kbd>E</kbd> clamp leaf &amp; measure';
        }
        prompt.classList.toggle('show', aimedInstance >= 0);
        if (measuredInstance < 0) setRing(aimedInstance, aimedInstance >= 0 ? '#ffffff' : null);
      }
    } else {
      crosshair.classList.remove('targeting');
      prompt.classList.remove('show');
      aimedInstance = -1;
      if (li600.state === 'measuring') {
        setRing(measuredInstance, '#d8b13a');
        tmpVec.set(basePos[measuredInstance * 3], controller.object.position.y, basePos[measuredInstance * 3 + 2]);
        if (controller.object.position.distanceTo(tmpVec) > CLAMP_RANGE + 1.0) {
          li600.release();
          measuredInstance = -1;
          ring.visible = false;
        }
      }
    }
  }

  // HUD (throttled).
  fpsAccum += 1 / dt;
  fpsFrames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    hudFps.textContent = Math.round(fpsAccum / fpsFrames);
    if (scale === 'satellite') {
      hudPos.textContent = scenery.region;
      hudAlt.textContent = `${satellite.altitudeKm.toLocaleString()} km`;
    } else {
      const p = scale === 'drone' ? drone.group.position : controller.object.position;
      hudPos.textContent = `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
      hudAlt.textContent = `${p.y.toFixed(1)} m`;
    }
    fpsAccum = fpsFrames = 0;
    fpsTimer = 0;
  }

  // Render.
  if (scale === 'satellite') {
    satellite.render(renderer); // three.js globe drawn into the main canvas
  } else if (scale === 'proximal') {
    renderer.autoClear = true;
    camera.layers.set(0);
    renderer.render(scene, camera);

    const bg = scene.background;
    scene.background = null;
    renderer.autoClear = false;
    renderer.clearDepth();
    camera.layers.set(VIEW_LAYER);
    renderer.render(scene, camera);
    scene.background = bg;

    renderer.autoClear = true;
    camera.layers.set(0);
  } else {
    renderer.autoClear = true;
    camera.layers.set(0);
    renderer.render(scene, camera);
  }
}
renderer.setAnimationLoop(animate);

// --- Dev-only hooks for automated verification (stripped from prod builds) ---
if (import.meta.env.DEV) {
  function extremeHealth(wantMin) {
    let best = 0;
    for (let i = 1; i < health.length; i++) {
      if (wantMin ? health[i] < health[best] : health[i] > health[best]) best = i;
    }
    return best;
  }
  window.__dev = {
    camera, renderer, scene, controller, li600, satellite, mission,
    // `field` is reassigned by cycleCrop, so expose it live (not a stale snapshot).
    get field() { return field; },
    get health() { return health; },
    setScale, setBand, cycleCrop,
    satZoom: (height = 9000) => {
      setScale('satellite');
      satellite.flyToHeight(height); // Cesium camera height in metres over the field
    },
    drone,
    droneOver: () => { setScale('drone'); drone.group.position.set(2, 24, 6); camera.rotation.set(-0.55, 0, 0, 'YXZ'); },
    measureExtreme: (wantMin) => {
      const i = extremeHealth(wantMin);
      li600.startMeasure(truePhysiology(health[i]));
      return { instance: i, health: health[i] };
    },
    step: (n, dt = 0.1) => { for (let k = 0; k < n; k++) li600.update(dt); },
  };
}
