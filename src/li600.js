import * as THREE from 'three';
import { measurePhysiology } from './healthField.js';

/**
 * LI-600 porometer / fluorometer — a first-person held instrument with a
 * clamp-and-measure interaction.
 *
 * Modeled on the LI-COR LI-600: a pistol-grip body, an angled display, and a
 * leaf-clamp head at the front. The instrument is rendered in a separate pass
 * (view layer) so it never clips into the corn.
 *
 * State machine:  idle → measuring (clamp closes, gsw stabilizes ~4s) → result
 */

export const VIEW_LAYER = 1;
const MEASURE_TIME = 4.0; // seconds for the reading to stabilize

const POSE = {
  idle: { pos: new THREE.Vector3(0.17, -0.2, -0.5), rot: new THREE.Euler(0.05, -0.35, 0.0) },
  measure: { pos: new THREE.Vector3(0.06, -0.13, -0.42), rot: new THREE.Euler(-0.15, -0.12, 0.0) },
};

export class LI600 {
  constructor() {
    this.state = 'idle';
    this.onResult = null;

    this.t = 0;
    this.jaw = 0.5; // current jaw open angle (rad)
    this._truth = null;
    this._live = null; // displayed values while stabilizing
    this.result = null;
    this._sway = 0;

    this._build();
    this._drawScreen();
  }

  // ---- model ----
  _build() {
    const group = new THREE.Group();
    group.position.copy(POSE.idle.pos);
    group.rotation.copy(POSE.idle.rot);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.55, metalness: 0.2 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x8bc53f, roughness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x202327, roughness: 0.7 });

    // Pistol grip (tilted handle).
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), bodyMat);
    grip.position.set(0, -0.08, 0.02);
    grip.rotation.x = 0.28;
    group.add(grip);

    // Main body block.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.16), bodyMat);
    body.position.set(0, 0.02, -0.02);
    group.add(body);

    // Green accent stripe.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.02, 0.16), accentMat);
    stripe.position.set(0, 0.065, -0.02);
    group.add(stripe);

    // Angled display facing the user.
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 256;
    screenCanvas.height = 168;
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });

    const screenPlate = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.055, 0.005), darkMat);
    screenPlate.position.set(0, 0.075, 0.06);
    screenPlate.rotation.x = -0.6;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.044), screenMat);
    screen.position.set(0, 0.003, 0.004);
    screenPlate.add(screen);
    group.add(screenPlate);

    // Clamp head reaching forward, with two jaws around an aperture.
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), bodyMat);
    head.position.set(0, 0.02, -0.13);
    group.add(head);

    const clampPivot = new THREE.Group();
    clampPivot.position.set(0, 0.02, -0.17);
    group.add(clampPivot);

    const jawGeo = new THREE.BoxGeometry(0.05, 0.012, 0.07);
    const upperJaw = new THREE.Mesh(jawGeo, darkMat);
    upperJaw.geometry.translate(0, 0, -0.035); // pivot at the back of the jaw
    upperJaw.position.set(0, 0.015, 0);
    const lowerJaw = new THREE.Mesh(jawGeo, darkMat);
    lowerJaw.geometry.translate(0, 0, -0.035);
    lowerJaw.position.set(0, -0.015, 0);
    clampPivot.add(upperJaw, lowerJaw);

    // Aperture ring (the clamp opening).
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.02, 0.004, 8, 16),
      accentMat
    );
    ring.position.set(0, 0, -0.05);
    clampPivot.add(ring);

    // Everything renders on the view layer so it sits on top of the world.
    group.traverse((o) => o.layers.set(VIEW_LAYER));

    this.group = group;
    this.upperJaw = upperJaw;
    this.lowerJaw = lowerJaw;
    this.screenCanvas = screenCanvas;
    this.screenCtx = screenCanvas.getContext('2d');
    this.screenTex = screenTex;
  }

  /**
   * Lights dedicated to the view layer so the held instrument is lit in its
   * own render pass. Parent these to the camera.
   */
  static makeViewLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.5, 0.8, 0.6);
    hemi.layers.set(VIEW_LAYER);
    key.layers.set(VIEW_LAYER);
    return [hemi, key];
  }

  // ---- interaction ----
  startMeasure(truth) {
    if (this.state !== 'idle') return;
    this.state = 'measuring';
    this.t = 0;
    this._truth = truth;
    // Start the live gsw somewhere off, converging toward the true reading.
    this._live = {
      gsw: truth.gsw * (0.3 + Math.random() * 0.5),
      phiPSII: 0,
      etr: 0,
      fvfmPrime: 0,
      parI: truth.parI,
    };
  }

  release() {
    this.state = 'idle';
    this._truth = null;
    this._live = null;
    this.result = null;
    this._drawScreen();
  }

  update(dt) {
    this._sway += dt;

    let pose = POSE.idle;
    let jawTarget = 0.5;

    if (this.state === 'measuring') {
      pose = POSE.measure;
      jawTarget = 0.04;
      this.t += dt;
      const a = Math.min(this.t / MEASURE_TIME, 1);

      // gsw stabilizes with an exponential approach + shrinking jitter.
      const ease = 1 - Math.exp(-3.2 * a);
      const noise = (Math.random() - 0.5) * 0.06 * (1 - a);
      this._live.gsw = this._truth.gsw * (ease + noise) + this._truth.gsw * 0.001;

      // Fluorescence is revealed by the saturating flash in the last ~25%.
      const fl = Math.max(0, (a - 0.75) / 0.25);
      this._live.phiPSII = this._truth.phiPSII * fl;
      this._live.etr = this._truth.etr * fl;
      this._live.fvfmPrime = this._truth.fvfmPrime * fl;

      this._drawScreen(a);

      if (a >= 1) {
        this.result = measurePhysiology(this._truth);
        this.state = 'result';
        this._drawScreen(1);
        if (this.onResult) this.onResult(this.result);
      }
    } else if (this.state === 'result') {
      pose = POSE.measure;
      jawTarget = 0.04;
    }

    // Smoothly ease pose + jaws.
    const k = 1 - Math.exp(-12 * dt);
    this.group.position.lerp(pose.pos, k);
    // idle sway
    if (this.state === 'idle') {
      this.group.position.x += Math.sin(this._sway * 1.3) * 0.0015;
      this.group.position.y += Math.sin(this._sway * 2.1) * 0.0015;
    }
    this.group.rotation.x += (pose.rot.x - this.group.rotation.x) * k;
    this.group.rotation.y += (pose.rot.y - this.group.rotation.y) * k;

    this.jaw += (jawTarget - this.jaw) * k;
    this.upperJaw.rotation.x = -this.jaw;
    this.lowerJaw.rotation.x = this.jaw;
  }

  // ---- screen rendering ----
  _drawScreen(progress = 0) {
    const ctx = this.screenCtx;
    const W = this.screenCanvas.width;
    const H = this.screenCanvas.height;

    ctx.fillStyle = '#0a1410';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8bc53f';
    ctx.font = 'bold 18px ui-monospace, monospace';
    ctx.fillText('LI-600', 10, 24);
    ctx.fillStyle = '#5a6f4a';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('porometer/fluorometer', 78, 23);
    ctx.strokeStyle = '#1d3a24';
    ctx.beginPath();
    ctx.moveTo(8, 32);
    ctx.lineTo(W - 8, 32);
    ctx.stroke();

    const line = (y, label, value, unit) => {
      ctx.fillStyle = '#9fb38f';
      ctx.font = '13px ui-monospace, monospace';
      ctx.fillText(label, 12, y);
      ctx.fillStyle = '#e8f3e0';
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(value, 200, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5a6f4a';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(unit, 204, y);
    };

    if (this.state === 'idle') {
      ctx.fillStyle = '#9fb38f';
      ctx.font = '14px ui-monospace, monospace';
      ctx.fillText('READY', 12, 64);
      ctx.fillStyle = '#5a6f4a';
      ctx.fillText('Aim at a leaf, press E', 12, 92);
      ctx.fillText('to clamp & measure.', 12, 110);
    } else {
      const v = this.state === 'result' ? this.result : this._live;
      line(60, 'gsw', v.gsw.toFixed(3), 'mol m-2 s-1');
      line(84, 'PhiPS2', v.phiPSII.toFixed(3), '');
      line(108, 'ETR', v.etr.toFixed(0), 'umol m-2 s-1');
      line(132, 'PARi', Math.round(v.parI).toString(), 'umol');

      // status / progress bar
      ctx.fillStyle = '#1d3a24';
      ctx.fillRect(12, 146, 188, 8);
      ctx.fillStyle = this.state === 'result' ? '#8bc53f' : '#d8b13a';
      const w = this.state === 'result' ? 188 : 188 * progress;
      ctx.fillRect(12, 146, w, 8);
      ctx.fillStyle = '#9fb38f';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(
        this.state === 'result' ? 'STABLE — logged' : 'measuring…',
        12,
        H - 2
      );
    }

    this.screenTex.needsUpdate = true;
  }
}
