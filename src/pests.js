import * as THREE from 'three';

/**
 * Strawberry aphid level: builds the ground decorations (yellow sticky-trap
 * flags — dense with bugs near sick plants — and buzzing aphid swarms over the
 * infested plants) plus the drone ladybug-release mechanic (ladybugs appear on
 * infested plants as the drone treats the patch; coverage 0..1).
 *
 * @param {Float32Array} basePos  per-plant xyz (from field.userData.basePos)
 * @param {Float32Array} health   per-plant 0..1 health
 * @param {{width:number,length:number}} bounds
 */
export function buildPests(basePos, health, bounds) {
  const group = new THREE.Group();
  const n = health.length;

  const infested = []; // stressed plant indices
  for (let i = 0; i < n; i++) if (health[i] < 0.45) infested.push(i);

  // --- yellow sticky-trap cards on thin metal poles, above the plants ---
  // A uniform grid; every card faces the same direction. Poles are one mesh
  // (metal), cards are split into clean / bug-covered by proximity to sick plants.
  const POLE_H = 0.95;      // pole height (well above the ~0.25 m strawberries)
  const CARD_Y = 0.82;      // card centre, near the top of the pole
  const poleGeo = new THREE.CylinderGeometry(0.008, 0.008, POLE_H, 6);
  poleGeo.translate(0, POLE_H / 2, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.75 });

  const cardGeo = new THREE.PlaneGeometry(0.2, 0.3);
  cardGeo.translate(0, CARD_Y, 0);
  const cleanMat = new THREE.MeshStandardMaterial({ map: flagTexture(5), roughness: 0.85, side: THREE.DoubleSide });
  const dirtyMat = new THREE.MeshStandardMaterial({ map: flagTexture(80), roughness: 0.85, side: THREE.DoubleSide });

  const all = [], clean = [], dirty = [];
  const halfW = bounds.width / 2, halfL = bounds.length / 2;
  const SPACING = 5;
  for (let x = -halfW; x <= halfW + 0.001; x += SPACING) {
    for (let z = -halfL; z <= halfL + 0.001; z += SPACING) {
      let near = false;
      for (const idx of infested) {
        const dx = x - basePos[idx * 3], dz = z - basePos[idx * 3 + 2];
        if (dx * dx + dz * dz < 16) { near = true; break; }
      }
      all.push({ x, z });
      (near ? dirty : clean).push({ x, z });
    }
  }
  group.add(flagMesh(poleGeo, poleMat, all));
  group.add(flagMesh(cardGeo, cleanMat, clean));
  group.add(flagMesh(cardGeo, dirtyMat, dirty));

  // --- buzzing aphid swarm (points) over the infested plants ---
  const swarm = infested.slice(0, 150);
  const per = 5;
  const count = swarm.length * per;
  const pos = new Float32Array(Math.max(3, count * 3));
  const base = new Float32Array(Math.max(3, count * 3));
  const phase = new Float32Array(Math.max(1, count));
  let a = 0;
  for (const idx of swarm) {
    for (let k = 0; k < per; k++) {
      const bx = basePos[idx * 3] + (Math.random() - 0.5) * 0.5;
      const by = 0.12 + Math.random() * 0.24;
      const bz = basePos[idx * 3 + 2] + (Math.random() - 0.5) * 0.5;
      base[a * 3] = pos[a * 3] = bx;
      base[a * 3 + 1] = pos[a * 3 + 1] = by;
      base[a * 3 + 2] = pos[a * 3 + 2] = bz;
      phase[a] = Math.random() * Math.PI * 2;
      a++;
    }
  }
  const apGeo = new THREE.BufferGeometry();
  apGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  apGeo.setDrawRange(0, count);
  const aphids = new THREE.Points(apGeo, new THREE.PointsMaterial({ color: 0x2c2515, size: 0.05, sizeAttenuation: true }));
  aphids.frustumCulled = false;
  group.add(aphids);

  const d = new THREE.Object3D();

  // --- coverage grid: ~3 m cells that contain infested plants ---
  const CELL = 3.0;
  const cellMap = new Map();
  for (const idx of infested) {
    const gx = Math.round(basePos[idx * 3] / CELL), gz = Math.round(basePos[idx * 3 + 2] / CELL);
    const key = gx + '_' + gz;
    if (!cellMap.has(key)) cellMap.set(key, { cx: gx * CELL, cz: gz * CELL });
  }
  const cells = [...cellMap.values()];

  // --- ladybugs: a few per cell, hidden until the cell is treated ---
  const PER = 6;
  const lbGeo = new THREE.SphereGeometry(0.11, 8, 6);
  lbGeo.scale(1, 0.55, 1.25);
  const lb = new THREE.InstancedMesh(lbGeo, new THREE.MeshStandardMaterial({ color: 0xcf2b23, roughness: 0.5 }), Math.max(1, cells.length * PER));
  lb.count = cells.length * PER;
  lb.castShadow = false;
  const lbPos = new Float32Array(Math.max(2, cells.length * PER * 2));
  for (let c = 0; c < cells.length; c++) {
    for (let k = 0; k < PER; k++) {
      const j = c * PER + k;
      lbPos[j * 2] = cells[c].cx + (Math.random() - 0.5) * CELL * 0.85;
      lbPos[j * 2 + 1] = cells[c].cz + (Math.random() - 0.5) * CELL * 0.85;
      d.position.set(lbPos[j * 2], 0.18, lbPos[j * 2 + 1]);
      d.scale.setScalar(0);
      d.updateMatrix();
      lb.setMatrixAt(j, d.matrix);
    }
  }
  lb.instanceMatrix.needsUpdate = true;
  group.add(lb);

  // --- treated overlay: a translucent green tile per treated cell (shows in any band) ---
  const ovGeo = new THREE.PlaneGeometry(CELL * 1.02, CELL * 1.02);
  ovGeo.rotateX(-Math.PI / 2);
  const ov = new THREE.InstancedMesh(ovGeo, new THREE.MeshBasicMaterial({ color: 0x6dfba0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }), Math.max(1, cells.length));
  ov.count = cells.length;
  ov.renderOrder = 4;
  for (let c = 0; c < cells.length; c++) {
    d.position.set(cells[c].cx, 0.4, cells[c].cz);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(0);
    d.updateMatrix();
    ov.setMatrixAt(c, d.matrix);
  }
  ov.instanceMatrix.needsUpdate = true;
  group.add(ov);

  // --- falling ladybug drop particles (exaggerated, so the release reads clearly) ---
  const DROP_N = 90;
  const drop = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: 0.5 }), DROP_N);
  drop.count = DROP_N;
  drop.castShadow = false;
  for (let i = 0; i < DROP_N; i++) { d.position.set(0, -999, 0); d.scale.setScalar(0); d.updateMatrix(); drop.setMatrixAt(i, d.matrix); }
  drop.instanceMatrix.needsUpdate = true;
  group.add(drop);
  const ds = [];
  for (let i = 0; i < DROP_N; i++) ds.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 2 + Math.random() * 5 });
  let dropCursor = 0, dropAccum = 0;

  const treated = new Uint8Array(Math.max(1, cells.length));
  let treatedCount = 0;
  let time = 0;

  function revealCell(c) {
    for (let k = 0; k < PER; k++) {
      const j = c * PER + k;
      d.position.set(lbPos[j * 2], 0.18, lbPos[j * 2 + 1]);
      d.rotation.set(0, Math.random() * 6.283, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      lb.setMatrixAt(j, d.matrix);
    }
    d.position.set(cells[c].cx, 0.4, cells[c].cz);
    d.rotation.set(0, 0, 0);
    d.scale.setScalar(1);
    d.updateMatrix();
    ov.setMatrixAt(c, d.matrix);
  }

  return {
    group,
    totalInfested: infested.length,
    update(dt) {
      time += dt;
      // aphids buzz
      const p = aphids.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        const ph = phase[i];
        p.array[i * 3] = base[i * 3] + Math.sin(time * 6 + ph) * 0.06;
        p.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(time * 7 + ph * 1.7) * 0.05;
        p.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(time * 6.5 + ph) * 0.06;
      }
      if (count) p.needsUpdate = true;
      // falling ladybug drops
      let anyDrop = false;
      for (let i = 0; i < DROP_N; i++) {
        const s = ds[i];
        if (!s.active) continue;
        s.vy -= 9 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        if (s.y <= 0.22) { s.active = false; d.position.set(0, -999, 0); d.scale.setScalar(0); }
        else { d.position.set(s.x, s.y, s.z); d.rotation.set(time * s.spin, time * s.spin * 0.7, 0); d.scale.setScalar(1); }
        d.updateMatrix();
        drop.setMatrixAt(i, d.matrix);
        anyDrop = true;
      }
      if (anyDrop) drop.instanceMatrix.needsUpdate = true;
    },
    /** Stream falling ladybugs from (x,y,z) while the release button is held. */
    emit(x, y, z, dt) {
      dropAccum += dt;
      while (dropAccum >= 0.04) {
        dropAccum -= 0.04;
        const s = ds[dropCursor];
        dropCursor = (dropCursor + 1) % DROP_N;
        s.active = true;
        s.x = x + (Math.random() - 0.5) * 1.6;
        s.y = y - 0.4;
        s.z = z + (Math.random() - 0.5) * 1.6;
        s.vx = (Math.random() - 0.5) * 1.0;
        s.vy = -2.0 - Math.random() * 1.5;
        s.vz = (Math.random() - 0.5) * 1.0;
      }
    },
    /** Treat infested cells within `radius` of (x,z); returns coverage 0..1. */
    treatAt(x, z, radius) {
      const r2 = radius * radius;
      let changed = false;
      for (let c = 0; c < cells.length; c++) {
        if (treated[c]) continue;
        const dx = x - cells[c].cx, dz = z - cells[c].cz;
        if (dx * dx + dz * dz < r2) { treated[c] = 1; treatedCount++; revealCell(c); changed = true; }
      }
      if (changed) { lb.instanceMatrix.needsUpdate = true; ov.instanceMatrix.needsUpdate = true; }
      return cells.length ? treatedCount / cells.length : 1;
    },
    coverage() { return cells.length ? treatedCount / cells.length : 1; },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    },
  };
}

// Instance `geo` at each item's (x, z) on the ground — no rotation, so all the
// cards face the same way.
function flagMesh(geo, mat, items) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  mesh.castShadow = false;
  const d = new THREE.Object3D();
  for (let i = 0; i < items.length; i++) {
    d.position.set(items[i].x, 0, items[i].z);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// A yellow sticky-trap card speckled with `bugs` dark dots (aphids stuck to it).
function flagTexture(bugs) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  x.fillStyle = '#e9d21f';
  x.fillRect(0, 0, s, s);
  x.fillStyle = 'rgba(120,100,10,0.25)';
  x.fillRect(0, 0, s, 4); // a strip of tackier edge
  for (let i = 0; i < bugs; i++) {
    x.fillStyle = Math.random() < 0.5 ? '#2a2410' : '#4a3d18';
    const r = 0.6 + Math.random() * 1.1;
    x.beginPath();
    x.arc(Math.random() * s, 6 + Math.random() * (s - 8), r, 0, Math.PI * 2);
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
