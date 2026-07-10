import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STATE_NDVI, NON_CONUS, ndviExtremes } from './stateNDVI.js';
import { asset } from './paths.js';

/**
 * Satellite (orbital) scale: a 3D globe you orbit and zoom.
 *
 * A real MODIS NDVI composite (public/data/conus_ndvi.png, from NASA GIBS) is
 * draped over the contiguous US at county-scale detail, with real state borders
 * (public/data/us-states.json) overlaid on top. Hover a state to highlight it and
 * read its name + average NDVI. Everything is bundled/static — no live tiles.
 *
 * The objective: find the highest- and lowest-NDVI states. Hovering both fires
 * onExtremesFound so the mission can complete.
 */

// Bounding box of the bundled NDVI raster (EPSG:4326), lon/lat.
const B = { w: -125, e: -66, s: 24, n: 50 };

function latLonToVec3(lat, lon, r) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}
function vec3ToLatLon(p) {
  const r = p.length();
  const lat = 90 - (Math.acos(THREE.MathUtils.clamp(p.y / r, -1, 1)) * 180) / Math.PI;
  let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180;
  while (lon < -180) lon += 360;
  while (lon > 180) lon -= 360;
  return { lat, lon };
}

function polygonsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class SatelliteView {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04060c);
    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.002, 200);

    this.scene.add(new THREE.AmbientLight(0x4a5a72, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.0);
    sun.position.set(3, 2, 4);
    this.scene.add(sun);
    this.scene.add(makeStars());

    // Base Earth.
    const loader = new THREE.TextureLoader();
    const day = loader.load(asset('textures/earth_atmos_2048.jpg'));
    day.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = 8;
    this.globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.MeshStandardMaterial({ map: day, roughness: 1, metalness: 0 })
    );
    this.scene.add(this.globe);

    // Atmosphere halo.
    this.scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x4a90d9, transparent: true, opacity: 0.12, side: THREE.BackSide })
    ));

    // NDVI raster draped over CONUS (a sphere patch UV-mapped to the raster bbox).
    const ndviTex = loader.load(asset('data/conus_ndvi.png'));
    ndviTex.colorSpace = THREE.SRGBColorSpace;
    ndviTex.anisotropy = 8;
    this.ndviPatch = new THREE.Mesh(
      buildPatchGeometry(72, 40),
      new THREE.MeshBasicMaterial({ map: ndviTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    this.ndviPatch.renderOrder = 1;
    this.scene.add(this.ndviPatch);

    // State-boundary overlay (all borders dim; a separate bright line for the hovered state).
    this.borders = new THREE.Group();
    this.scene.add(this.borders);
    this._stateSegs = {}; // name -> Float32Array of segment endpoints on the globe
    this.hoverLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false })
    );
    this.hoverLine.renderOrder = 3;
    this.scene.add(this.hoverLine);

    // Field-site pin.
    this.site = null;
    this.pin = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd23a })
    );
    this.pin.visible = false;
    this.pin.renderOrder = 4;
    this.scene.add(this.pin);

    // Controls — allow zooming close to read county-scale detail.
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.02;
    this.controls.maxDistance = 6;
    this.controls.zoomSpeed = 0.9;
    this.controls.rotateSpeed = 0.55;
    this.controls.enabled = false;
    this.camera.position.copy(latLonToVec3(38, -95, 1).normalize().multiplyScalar(2.4));
    this.controls.update();

    // Hover state.
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._mouse = { x: 0, y: 0, inside: false };
    this.hovered = null;
    this.bandId = 'rgb';
    this.features = [];
    this.extremes = ndviExtremes();
    this.foundMax = false; this.foundMin = false; this.onExtremesFound = null;
    this.onHover = null; // (name) => void — fires when the hovered state changes

    this.tip = document.createElement('div');
    Object.assign(this.tip.style, {
      position: 'fixed', zIndex: '6', pointerEvents: 'none', display: 'none',
      font: '13px system-ui, sans-serif', color: '#e8f3e0',
      background: 'rgba(10,18,12,0.92)', border: '1px solid rgba(124,194,66,0.4)',
      borderRadius: '7px', padding: '7px 10px', whiteSpace: 'nowrap',
      boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
    });
    document.body.appendChild(this.tip);

    this._onMove = this._handleMove.bind(this);
    this._onLeave = () => { this._mouse.inside = false; this._setHovered(null); };

    fetch(asset('data/us-states.json')).then((r) => r.json()).then((geo) => {
      this.features = geo.features.filter((f) => !NON_CONUS.has(f.properties.name) && STATE_NDVI[f.properties.name] != null);
      this._buildBorders();
    }).catch((e) => console.warn('state borders failed to load', e));
  }

  _buildBorders() {
    const all = [];
    for (const f of this.features) {
      const segs = [];
      for (const poly of polygonsOf(f.geometry)) {
        for (const ring of poly) {
          for (let i = 0; i < ring.length - 1; i++) {
            const a = latLonToVec3(ring[i][1], ring[i][0], 1.004);
            const b = latLonToVec3(ring[i + 1][1], ring[i + 1][0], 1.004);
            segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
            all.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
      }
      this._stateSegs[f.properties.name] = new Float32Array(segs);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf2f8ec, transparent: true, opacity: 0.4 }));
    line.renderOrder = 2;
    this.borders.add(line);
  }

  // --- API ---------------------------------------------------------------
  setBand(id) {
    this.bandId = id;
    this.ndviPatch.visible = id !== 'rgb'; // RGB = plain true-color Earth; any index = NDVI drape
  }

  setSite(lat, lon) {
    // The national NDVI objective is about the whole country, so we no longer
    // drop a field-site marker — the pin stays hidden.
    this.site = { lat, lon };
  }

  flyToLocation(lat, lon) { this._swingTo(lat, lon, 1.6); }

  _swingTo(lat, lon, dist) {
    const d = dist || this.camera.position.length() || 2.0;
    this.camera.position.copy(latLonToVec3(lat, lon, 1).normalize().multiplyScalar(d));
    this.controls.update();
  }

  flyToHeight(height) {
    const d = THREE.MathUtils.clamp(1 + height / 6371000, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.setLength(d);
    this.controls.update();
  }

  setActive(on) {
    this.controls.enabled = on;
    if (on) {
      this.resize();
      this.renderer.domElement.addEventListener('mousemove', this._onMove);
      this.renderer.domElement.addEventListener('mouseleave', this._onLeave);
    } else {
      this.renderer.domElement.removeEventListener('mousemove', this._onMove);
      this.renderer.domElement.removeEventListener('mouseleave', this._onLeave);
      this._setHovered(null);
    }
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  get altitudeKm() { return Math.round((this.camera.position.length() - 1) * 6371); }

  update(dt) {
    this.controls.update();
    if (this._mouse.inside) this._pick();
  }

  render(renderer) {
    renderer.autoClear = true;
    this.camera.layers.set(0);
    renderer.render(this.scene, this.camera);
  }

  // --- hover -------------------------------------------------------------
  _handleMove(e) {
    this._mouse = { x: e.clientX, y: e.clientY, inside: true };
    this._pick();
  }

  _pick() {
    this._ndc.set((this._mouse.x / window.innerWidth) * 2 - 1, -(this._mouse.y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.globe, false)[0];
    let name = null;
    if (hit) {
      const { lat, lon } = vec3ToLatLon(hit.point);
      if (lon >= B.w - 2 && lon <= B.e + 2 && lat >= B.s - 2 && lat <= B.n + 2) {
        for (const f of this.features) {
          if (polygonsOf(f.geometry).some((poly) => inRing(lon, lat, poly[0]))) { name = f.properties.name; break; }
        }
      }
    }
    this._setHovered(name);
  }

  _setHovered(name) {
    if (name !== this.hovered) {
      this.hovered = name;
      const segs = name ? this._stateSegs[name] : null;
      this.hoverLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(segs || [], 3));
      this.hoverLine.geometry.getAttribute('position').needsUpdate = true;
      if (name === this.extremes.max.name) this.foundMax = true;
      if (name === this.extremes.min.name) this.foundMin = true;
      if (this.foundMax && this.foundMin && this.onExtremesFound) { const cb = this.onExtremesFound; this.onExtremesFound = null; cb(); }
      if (name && this.onHover) this.onHover(name);
    }
    // Tooltip — just the raw value; students work out the extremes themselves.
    if (name && this._mouse.inside) {
      const ndvi = STATE_NDVI[name];
      this.tip.innerHTML = `<div style="font-weight:600">${name}</div><div style="font-family:ui-monospace,monospace;color:#cfe3bd">NDVI ${ndvi.toFixed(2)}</div>`;
      this.tip.style.display = 'block';
      this.tip.style.left = Math.min(this._mouse.x + 14, window.innerWidth - 220) + 'px';
      this.tip.style.top = this._mouse.y + 14 + 'px';
    } else {
      this.tip.style.display = 'none';
    }
  }
}

// A subdivided sphere patch over the raster bbox, UV-mapped to the raster.
function buildPatchGeometry(nx, ny) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) {
    const lat = B.s + (j / ny) * (B.n - B.s);
    for (let i = 0; i <= nx; i++) {
      const lon = B.w + (i / nx) * (B.e - B.w);
      const v = latLonToVec3(lat, lon, 1.002);
      pos.push(v.x, v.y, v.z);
      uv.push(i / nx, j / ny);
    }
  }
  const w = nx + 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function makeStars() {
  const N = 1400, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 40 + (i % 20);
    const th = (i * 2.399963) % (Math.PI * 2), ph = Math.acos(1 - 2 * ((i * 0.6180339) % 1));
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph);
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, sizeAttenuation: true }));
}
