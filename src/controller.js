import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.5;
const SPRINT_SPEED = 9.0;
const GRAVITY = 22.0;
const JUMP_VELOCITY = 7.5;

const FLY_SPEED = 16.0;
const FLY_BOOST = 38.0;
const FLY_MIN_Y = 3.0;
const FLY_MAX_Y = 90.0;
const FOLLOW_DIST = 3.6; // chase camera distance behind the drone
const FOLLOW_HEIGHT = 0.7;

/**
 * One pointer-lock camera with two movement modes:
 *   - 'walk' (proximal): gravity, eye height, WASD + sprint + jump
 *   - 'fly'  (drone):    free 6-DOF, WASD horizontal + Space/C altitude + boost
 */
export class Controller {
  constructor(camera, domElement) {
    this.controls = new PointerLockControls(camera, domElement);
    this.object = this.controls.object; // the camera
    this.mode = 'walk';

    this.velocity = new THREE.Vector3();
    this.onGround = true;

    this.keys = {
      forward: false, back: false, left: false, right: false,
      sprint: false, up: false, down: false,
    };

    this._onKeyDown = (e) => this._setKey(e.code, true);
    this._onKeyUp = (e) => this._setKey(e.code, false);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._flatF = new THREE.Vector3();

    this.drone = null; // Drone instance, set via setDrone()

    this.object.position.set(0, EYE_HEIGHT, 31);
  }

  setDrone(drone) {
    this.drone = drone;
  }

  _setKey(code, down) {
    switch (code) {
      case 'KeyW': case 'ArrowUp': this.keys.forward = down; break;
      case 'KeyS': case 'ArrowDown': this.keys.back = down; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = down; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = down; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = down; break;
      case 'KeyC': case 'ControlLeft': this.keys.down = down; break;
      case 'Space':
        this.keys.up = down;
        if (down && this.mode === 'walk' && this.onGround) {
          this.velocity.y = JUMP_VELOCITY;
          this.onGround = false;
        }
        break;
    }
  }

  get locked() {
    return this.controls.isLocked;
  }

  lock() {
    this.controls.lock();
  }

  /** Switch movement mode and reposition the camera for that scale. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.velocity.set(0, 0, 0);
    if (mode === 'walk') {
      this.object.position.set(0, EYE_HEIGHT, 31);
      this.object.rotation.set(-0.05, 0, 0, 'YXZ');
      this.onGround = true;
      if (this.drone) this.drone.group.visible = false;
    } else {
      // Place the drone above the field; the camera chases it.
      if (this.drone) {
        this.drone.group.visible = true;
        this.drone.group.position.set(0, 45, 28);
      }
      this.object.rotation.set(-0.5, 0, 0, 'YXZ'); // look down toward the field
      this._updateChaseCamera(); // frame the drone immediately
    }
  }

  _updateChaseCamera() {
    if (!this.drone) return;
    this.controls.getDirection(this._forward);
    this.object.position
      .copy(this.drone.group.position)
      .addScaledVector(this._forward, -FOLLOW_DIST);
    this.object.position.y += FOLLOW_HEIGHT;
    if (this.object.position.y < 0.6) this.object.position.y = 0.6;
  }

  update(dt, bounds) {
    if (this.mode === 'walk') this._updateWalk(dt, bounds);
    else this._updateFly(dt, bounds);
  }

  _updateWalk(dt, bound) {
    if (this.controls.isLocked) {
      this.controls.getDirection(this._forward);
      this._forward.y = 0;
      this._forward.normalize();
      this._right.crossVectors(this._forward, THREE.Object3D.DEFAULT_UP).normalize();

      const speed = this.keys.sprint ? SPRINT_SPEED : WALK_SPEED;
      const move = new THREE.Vector3();
      if (this.keys.forward) move.add(this._forward);
      if (this.keys.back) move.sub(this._forward);
      if (this.keys.right) move.add(this._right);
      if (this.keys.left) move.sub(this._right);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
      this.object.position.addScaledVector(move, dt);
    }

    this.velocity.y -= GRAVITY * dt;
    this.object.position.y += this.velocity.y * dt;
    if (this.object.position.y <= EYE_HEIGHT) {
      this.object.position.y = EYE_HEIGHT;
      this.velocity.y = 0;
      this.onGround = true;
    }

    if (bound) {
      this.object.position.x = THREE.MathUtils.clamp(this.object.position.x, -bound, bound);
      this.object.position.z = THREE.MathUtils.clamp(this.object.position.z, -bound, bound);
    }
  }

  _updateFly(dt, bound) {
    if (!this.drone) return;
    const rig = this.drone.group;

    // Camera-relative horizontal basis (heading = where you're looking).
    this.controls.getDirection(this._forward);
    this._flatF.set(this._forward.x, 0, this._forward.z);
    let yaw = this.object.rotation.y;
    if (this._flatF.lengthSq() > 1e-4) {
      this._flatF.normalize();
      yaw = Math.atan2(this._flatF.x, this._flatF.z);
    }
    this._right.crossVectors(this._flatF, THREE.Object3D.DEFAULT_UP).normalize();

    const fwd = (this.keys.forward ? 1 : 0) - (this.keys.back ? 1 : 0);
    const side = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const climb = (this.keys.up ? 1 : 0) - (this.keys.down ? 1 : 0);

    if (this.controls.isLocked) {
      const speed = this.keys.sprint ? FLY_BOOST : FLY_SPEED;
      const move = new THREE.Vector3()
        .addScaledVector(this._flatF, fwd)
        .addScaledVector(this._right, side);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
      rig.position.addScaledVector(move, dt);
      rig.position.y += climb * speed * dt;
    }

    rig.position.y = THREE.MathUtils.clamp(rig.position.y, FLY_MIN_Y, FLY_MAX_Y);
    if (bound) {
      rig.position.x = THREE.MathUtils.clamp(rig.position.x, -bound, bound);
      rig.position.z = THREE.MathUtils.clamp(rig.position.z, -bound, bound);
    }

    // Animate the drone and chase it with the camera.
    this.drone.update(dt, {
      yaw,
      fwd,
      side,
      climb,
      active: this.controls.isLocked && (fwd || side || climb),
    });
    this._updateChaseCamera();
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this.controls.dispose();
  }
}
