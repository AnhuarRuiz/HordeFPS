import * as THREE from 'three';
import type { CollisionBox } from '../world/Arena.ts';

const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const MOVE_SPEED = 6;
const SPRINT_SPEED = 9.5;
const ACCEL = 12;
const DAMPING = 10;
const JUMP_SPEED = 6.2;
const GRAVITY = -18;
const MOUSE_SENSITIVITY = 0.0022;
const TOUCH_LOOK_SENSITIVITY = 0.0032;
const AIM_SPEED_MULT = 0.55;

export class FirstPersonController {
  readonly camera: THREE.PerspectiveCamera;

  private domElement: HTMLElement;
  private collisionBoxes: CollisionBox[];
  private bounds: CollisionBox;
  private onLockChange: (locked: boolean) => void;

  private yaw = 0;
  private pitch = 0;

  private position = new THREE.Vector2(0, 0);
  private velocity = new THREE.Vector2(0, 0);
  private verticalVelocity = 0;
  private airborneOffset = 0;
  private grounded = true;

  private keys = new Set<string>();
  private touchMoveX = 0;
  private touchMoveZ = 0;
  private _locked = false;
  private aiming = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    collisionBoxes: CollisionBox[],
    bounds: CollisionBox,
    startPosition: THREE.Vector3,
    onLockChange: (locked: boolean) => void,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.collisionBoxes = collisionBoxes;
    this.bounds = bounds;
    this.onLockChange = onLockChange;
    this.position.set(startPosition.x, startPosition.z);

    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(this.position.x, EYE_HEIGHT, this.position.y);

    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('pointerlockchange', () => this.handleLockChange());
  }

  get locked(): boolean {
    return this._locked;
  }

  lock() {
    this.domElement.requestPointerLock();
  }

  // Touch devices have no pointer-lock concept (look is driven by drag deltas
  // instead), so this just flips the same "locked" flag the game loop checks.
  enableTouch() {
    this._locked = true;
    this.onLockChange(true);
  }

  press(code: string) {
    this.keys.add(code);
  }

  release(code: string) {
    this.keys.delete(code);
  }

  setTouchMove(x: number, z: number) {
    this.touchMoveX = x;
    this.touchMoveZ = z;
  }

  setAiming(aiming: boolean) {
    this.aiming = aiming;
  }

  addLookDelta(dx: number, dy: number) {
    this.applyLook(dx * TOUCH_LOOK_SENSITIVITY, dy * TOUCH_LOOK_SENSITIVITY);
  }

  private handleLockChange() {
    this._locked = document.pointerLockElement === this.domElement;
    this.onLockChange(this._locked);
  }

  private handleMouseMove(e: MouseEvent) {
    if (!this._locked) return;
    this.applyLook(e.movementX * MOUSE_SENSITIVITY, e.movementY * MOUSE_SENSITIVITY);
  }

  private applyLook(dYaw: number, dPitch: number) {
    this.yaw -= dYaw;
    this.pitch -= dPitch;
    const limit = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  private resolveCollision(next: THREE.Vector2) {
    next.x = Math.max(this.bounds.minX + PLAYER_RADIUS, Math.min(this.bounds.maxX - PLAYER_RADIUS, next.x));
    next.y = Math.max(this.bounds.minZ + PLAYER_RADIUS, Math.min(this.bounds.maxZ - PLAYER_RADIUS, next.y));

    for (const box of this.collisionBoxes) {
      const closestX = Math.max(box.minX, Math.min(next.x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(next.y, box.maxZ));
      const dx = next.x - closestX;
      const dz = next.y - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS && distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        const push = PLAYER_RADIUS - dist;
        next.x += (dx / dist) * push;
        next.y += (dz / dist) * push;
      }
    }
  }

  update(dt: number) {
    const forward = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const right = new THREE.Vector2(-forward.y, forward.x);

    let inputX = this.touchMoveX;
    let inputZ = this.touchMoveZ;
    if (this.keys.has('KeyW')) inputZ += 1;
    if (this.keys.has('KeyS')) inputZ -= 1;
    if (this.keys.has('KeyD')) inputX += 1;
    if (this.keys.has('KeyA')) inputX -= 1;

    const wishDir = new THREE.Vector2().addScaledVector(forward, inputZ).addScaledVector(right, inputX);
    if (wishDir.lengthSq() > 1) wishDir.normalize();

    const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const targetSpeed = (sprinting ? SPRINT_SPEED : MOVE_SPEED) * (this.aiming ? AIM_SPEED_MULT : 1);
    const targetVel = wishDir.clone().multiplyScalar(targetSpeed);

    const rate = wishDir.lengthSq() > 0 ? ACCEL : DAMPING;
    const t = Math.min(1, rate * dt);
    this.velocity.x += (targetVel.x - this.velocity.x) * t;
    this.velocity.y += (targetVel.y - this.velocity.y) * t;

    const next = this.position.clone().addScaledVector(this.velocity, dt);
    this.resolveCollision(next);
    this.position.copy(next);

    if (this.grounded && this.keys.has('Space')) {
      this.verticalVelocity = JUMP_SPEED;
      this.grounded = false;
    }
    this.verticalVelocity += GRAVITY * dt;
    this.airborneOffset += this.verticalVelocity * dt;
    if (this.airborneOffset <= 0) {
      this.airborneOffset = 0;
      this.verticalVelocity = 0;
      this.grounded = true;
    }

    this.camera.position.set(this.position.x, EYE_HEIGHT + this.airborneOffset, this.position.y);
  }
}
