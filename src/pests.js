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

  // --- yellow sticky-trap flags on a jittered grid ---
  const flagGeo = new THREE.PlaneGeometry(0.2, 0.34);
  flagGeo.translate(0, 0.17, 0); // stand on the ground
  const cleanMat = new THREE.MeshStandardMaterial({ map: flagTexture(5), roughness: 0.85, side: THREE.DoubleSide });
  const dirtyMat = new THREE.MeshStandardMaterial({ map: flagTexture(80), roughness: 0.85, side: THREE.DoubleSide });

  const clean = [], dirty = [];
  const halfW = bounds.width / 2, halfL = bounds.length / 2;
  for (let x = -halfW; x <= halfW; x += 5.5) {
    for (let z = -halfL; z <= halfL; z += 5.5) {
      const wx = x + (Math.random() - 0.5) * 2.5;
      const wz = z + (Math.random() - 0.5) * 2.5;
      let near = false;
      for (const idx of infested) {
        const dx = wx - basePos[idx * 3], dz = wz - basePos[idx * 3 + 2];
        if (dx * dx + dz * dz < 16) { near = true; break; }
      }
      (near ? dirty : clean).push({ x: wx, z: wz, rot: Math.random() * Math.PI });
    }
  }
  group.add(flagMesh(flagGeo, cleanMat, clean));
  group.add(flagMesh(flagGeo, dirtyMat, dirty));

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

  // --- ladybugs, hidden until the drone treats each plant ---
  const lbGeo = new THREE.SphereGeometry(0.09, 8, 6);
  lbGeo.scale(1, 0.55, 1.25);
  const lb = new THREE.InstancedMesh(
    lbGeo,
    new THREE.MeshStandardMaterial({ color: 0xcf2b23, roughness: 0.5 }),
    Math.max(1, infested.length)
  );
  lb.castShadow = false;
  lb.count = infested.length;
  const d = new THREE.Object3D();
  for (let i = 0; i < infested.length; i++) {
    const idx = infested[i];
    d.position.set(basePos[idx * 3], 0.16, basePos[idx * 3 + 2]);
    d.scale.setScalar(0);
    d.updateMatrix();
    lb.setMatrixAt(i, d.matrix);
  }
  lb.instanceMatrix.needsUpdate = true;
  group.add(lb);

  const treated = new Uint8Array(Math.max(1, infested.length));
  let treatedCount = 0;
  let time = 0;

  return {
    group,
    totalInfested: infested.length,
    update(dt) {
      time += dt;
      const p = aphids.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        const ph = phase[i];
        p.array[i * 3] = base[i * 3] + Math.sin(time * 6 + ph) * 0.06;
        p.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(time * 7 + ph * 1.7) * 0.05;
        p.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(time * 6.5 + ph) * 0.06;
      }
      if (count) p.needsUpdate = true;
    },
    /** Reveal ladybugs on infested plants within `radius` of (x,z); returns coverage. */
    treatAt(x, z, radius) {
      const r2 = radius * radius;
      let changed = false;
      for (let i = 0; i < infested.length; i++) {
        if (treated[i]) continue;
        const idx = infested[i];
        const dx = x - basePos[idx * 3], dz = z - basePos[idx * 3 + 2];
        if (dx * dx + dz * dz < r2) {
          treated[i] = 1; treatedCount++;
          d.position.set(basePos[idx * 3], 0.16, basePos[idx * 3 + 2]);
          d.rotation.set(0, Math.random() * Math.PI * 2, 0);
          d.scale.setScalar(1);
          d.updateMatrix();
          lb.setMatrixAt(i, d.matrix);
          changed = true;
        }
      }
      if (changed) lb.instanceMatrix.needsUpdate = true;
      return infested.length ? treatedCount / infested.length : 1;
    },
    coverage() { return infested.length ? treatedCount / infested.length : 1; },
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

function flagMesh(geo, mat, items) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  mesh.castShadow = false;
  const d = new THREE.Object3D();
  for (let i = 0; i < items.length; i++) {
    d.position.set(items[i].x, 0, items[i].z);
    d.rotation.set(0, items[i].rot, 0);
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
