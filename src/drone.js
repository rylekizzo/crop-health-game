import * as THREE from 'three';

/**
 * A procedurally-built agricultural survey quadcopter for the third-person
 * drone scale. Sleek white shell, X-frame arms, four spinning rotors, landing
 * skids, status LEDs, and a downward-facing multispectral sensor gimbal (the
 * "camera" that captures the spectral bands).
 *
 * Structure:  group (world position + heading/yaw)
 *               └ tilt (banks pitch/roll with input)
 *                   └ body, arms, rotors, gear, gimbal, LEDs
 */
export class Drone {
  constructor() {
    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.group.add(this.tilt);

    this.rotors = [];
    this._bob = 0;
    this._yaw = 0;
    this._pitch = 0;
    this._roll = 0;

    this._build();
    this.group.visible = false;
  }

  _build() {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.42, metalness: 0.12 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.5, metalness: 0.35 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x8bc53f, roughness: 0.45 });
    const propMat = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.6, metalness: 0.1 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1014, roughness: 0.15, metalness: 0.6 });

    const t = this.tilt;

    // --- Fuselage: stacked, tapered shells ---
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.26), shellMat);
    lower.position.y = 0;
    bevelTop(lower);
    t.add(lower);

    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.2), shellMat);
    mid.position.y = 0.055;
    t.add(mid);

    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
    canopy.scale.set(1.0, 0.55, 0.72);
    canopy.position.y = 0.085;
    t.add(canopy);

    // Green accent stripe + nose marker.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.012, 0.04), accentMat);
    stripe.position.set(0, 0.092, 0);
    t.add(stripe);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), accentMat);
    nose.position.set(0, 0.06, -0.13);
    t.add(nose);

    // --- Arms + rotors (X configuration) ---
    const reach = 0.26;
    const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
    angles.forEach((a, i) => {
      const dx = Math.sin(a) * reach;
      const dz = Math.cos(a) * reach;

      // Arm: tapered box from center to motor.
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, reach), darkMat);
      arm.position.set(dx / 2, 0.0, dz / 2);
      arm.lookAt(new THREE.Vector3(dx, 0.0, dz));
      t.add(arm);

      // Motor housing.
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 14), darkMat);
      motor.position.set(dx, 0.02, dz);
      t.add(motor);
      const motorCap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12), accentMat);
      motorCap.position.set(dx, 0.05, dz);
      t.add(motorCap);

      // Rotor hub (spins) with two blades + a faint motion-blur disc.
      const hub = new THREE.Group();
      hub.position.set(dx, 0.062, dz);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.24), propMat);
      const blade2 = blade.clone();
      blade2.rotation.y = Math.PI / 2;
      hub.add(blade, blade2);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.12, 24),
        new THREE.MeshBasicMaterial({ color: 0x9099a0, transparent: true, opacity: 0.06, side: THREE.DoubleSide })
      );
      disc.rotation.x = -Math.PI / 2;
      hub.add(disc);
      hub.userData.dir = i % 2 === 0 ? 1 : -1; // alternate spin like a real quad
      t.add(hub);
      this.rotors.push(hub);
    });

    // --- Landing skids ---
    const skidMat = darkMat;
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.28), skidMat);
      rail.position.set(side * 0.12, -0.085, 0);
      t.add(rail);
      for (const zz of [-0.09, 0.09]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.075, 0.014), skidMat);
        strut.position.set(side * 0.12, -0.045, zz);
        t.add(strut);
      }
    }

    // --- Downward multispectral sensor gimbal ---
    const gimbalArm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), darkMat);
    gimbalArm.position.set(0, -0.05, -0.05);
    t.add(gimbalArm);
    const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 16), darkMat);
    sensor.position.set(0, -0.085, -0.05);
    t.add(sensor);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    lens.rotation.x = Math.PI; // dome facing down
    lens.position.set(0, -0.105, -0.05);
    t.add(lens);

    // --- Status LEDs (front green, rear red) for orientation ---
    const led = (color, x, z) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 })
      );
      m.position.set(x, 0.03, z);
      t.add(m);
    };
    led(0x35e06a, -0.1, -0.12);
    led(0x35e06a, 0.1, -0.12);
    led(0xff3b3b, -0.1, 0.12);
    led(0xff3b3b, 0.1, 0.12);

    // Shadows for the solid parts.
    t.traverse((o) => {
      if (o.isMesh && o.material !== propMat) o.castShadow = true;
    });

    // Scale up a touch for third-person readability over 2 m corn.
    this.group.scale.setScalar(1.5);
  }

  /**
   * @param {number} dt
   * @param {{yaw:number, fwd:number, side:number, climb:number, active:boolean}} input
   */
  update(dt, input) {
    // Spin rotors — faster when flying/climbing.
    const rpm = 42 + (input.active ? 18 : 0) + Math.abs(input.climb) * 20;
    for (const hub of this.rotors) hub.rotation.y += hub.userData.dir * rpm * dt;

    // Smoothly turn to face the camera heading.
    this._yaw = lerpAngle(this._yaw, input.yaw, 1 - Math.exp(-8 * dt));
    this.group.rotation.y = this._yaw;

    // Bank into motion: nose down when going forward, roll when strafing.
    const maxBank = 0.32;
    const targetPitch = THREE.MathUtils.clamp(input.fwd * maxBank, -maxBank, maxBank);
    const targetRoll = THREE.MathUtils.clamp(-input.side * maxBank, -maxBank, maxBank);
    const k = 1 - Math.exp(-6 * dt);
    this._pitch += (targetPitch - this._pitch) * k;
    this._roll += (targetRoll - this._roll) * k;
    this.tilt.rotation.x = this._pitch;
    this.tilt.rotation.z = this._roll;

    // Subtle hover bob.
    this._bob += dt;
    this.tilt.position.y = Math.sin(this._bob * 2.4) * 0.015;
  }
}

// Slightly bevel the top edges of a box by nudging the top vertices inward.
function bevelTop(mesh) {
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * 0.82);
      pos.setZ(i, pos.getZ(i) * 0.82);
    }
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
